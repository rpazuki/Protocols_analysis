-- Narrow, audited account operations. The app never receives table-level
-- INSERT or credential UPDATE privileges and continues to use protocols_app.
ALTER TABLE public.local_accounts ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.protocols_manage_local_account(
  p_actor text, p_version integer, p_email text, p_operation text, p_hash text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  target public.local_accounts%ROWTYPE;
  target_admin boolean;
  pinned boolean;
  action_name text;
BEGIN
  PERFORM pg_advisory_xact_lock(7281946501);
  p_actor := lower(btrim(p_actor));
  p_email := lower(btrim(p_email));
  IF NOT EXISTS (
    SELECT 1 FROM public.local_accounts l JOIN public.admin_allowlist a USING(email)
    WHERE l.email=p_actor AND l.is_active AND NOT l.must_change_password
      AND l.credential_version=p_version AND a.removed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.researcher_denylist d WHERE d.email=l.email AND d.removed_at IS NULL)
  ) THEN RAISE EXCEPTION 'An active administrator session is required.' USING ERRCODE='42501'; END IF;
  IF p_operation IS NULL OR p_operation NOT IN ('create','reset','disable','reactivate','promote','demote') THEN
    RAISE EXCEPTION 'Unknown account operation.';
  END IF;
  IF p_email IS NULL OR length(p_email)>320 OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Supply a valid email address.';
  END IF;
  IF p_operation IN ('create','reset') AND (p_hash IS NULL OR p_hash !~ '^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$') THEN
    RAISE EXCEPTION 'A valid password hash is required.';
  END IF;
  SELECT * INTO target FROM public.local_accounts WHERE email=p_email FOR UPDATE;
  IF p_operation='create' THEN
    IF FOUND THEN RAISE EXCEPTION 'An account already exists for this email.'; END IF;
    IF EXISTS (SELECT 1 FROM public.researcher_denylist WHERE email=p_email AND removed_at IS NULL) THEN
      RAISE EXCEPTION 'This email is blocked. Restore access before creating an account.';
    END IF;
    INSERT INTO public.local_accounts(email,password_hash,must_change_password) VALUES(p_email,p_hash,true);
    action_name := 'local-account.create';
  ELSE
    -- Local-mode admins may also remove historical SSO-only allowlist entries.
    IF NOT FOUND AND p_operation<>'demote' THEN RAISE EXCEPTION 'No local account exists for this email.'; END IF;
    SELECT EXISTS(SELECT 1 FROM public.admin_allowlist WHERE email=p_email AND removed_at IS NULL),
           EXISTS(SELECT 1 FROM public.admin_allowlist WHERE email=p_email AND removed_at IS NULL AND from_config)
      INTO target_admin,pinned;
    IF p_operation='demote' AND NOT target_admin THEN
      RAISE EXCEPTION 'This email is not currently an administrator.';
    END IF;
    IF p_operation IN ('disable','reset') AND p_actor=p_email THEN
      RAISE EXCEPTION 'Use Change password for your own account. You cannot disable yourself.';
    END IF;
    IF p_operation IN ('disable','demote') AND pinned THEN
      RAISE EXCEPTION 'This administrator is protected by deployment configuration.';
    END IF;
    IF p_operation IN ('disable','demote') AND target_admin AND NOT EXISTS (
      SELECT 1 FROM public.admin_allowlist a JOIN public.local_accounts l USING(email)
      WHERE a.removed_at IS NULL AND l.is_active AND a.email<>p_email
        AND NOT EXISTS (SELECT 1 FROM public.researcher_denylist d WHERE d.email=a.email AND d.removed_at IS NULL)
    ) THEN RAISE EXCEPTION 'The last active local administrator is protected.'; END IF;
    IF p_operation='reset' THEN
      UPDATE public.local_accounts SET password_hash=p_hash, must_change_password=true,
        credential_version=credential_version+1, failed_login_count=0, locked_until=NULL, updated_at=now() WHERE email=p_email;
      action_name := 'local-account.reset';
    ELSIF p_operation IN ('disable','reactivate') THEN
      IF p_operation='reactivate' AND EXISTS (SELECT 1 FROM public.researcher_denylist WHERE email=p_email AND removed_at IS NULL) THEN
        RAISE EXCEPTION 'This email is blocked. Restore access before reactivating the account.';
      END IF;
      UPDATE public.local_accounts SET is_active=(p_operation='reactivate'), credential_version=credential_version+1,
        failed_login_count=0, locked_until=NULL, updated_at=now() WHERE email=p_email;
      action_name := CASE WHEN p_operation='disable' THEN 'local-account.disable' ELSE 'local-account.reactivate' END;
    ELSIF p_operation='promote' THEN
      IF NOT target.is_active OR EXISTS (SELECT 1 FROM public.researcher_denylist WHERE email=p_email AND removed_at IS NULL) THEN
        RAISE EXCEPTION 'Activate this account and restore its access before making it an administrator.';
      END IF;
      INSERT INTO public.admin_allowlist(email,added_by) VALUES(p_email,p_actor)
        ON CONFLICT(email) DO UPDATE SET removed_at=NULL, removed_by=NULL, added_at=now(), added_by=p_actor;
      action_name := 'admin.add';
    ELSE
      UPDATE public.admin_allowlist SET removed_at=now(),removed_by=p_actor WHERE email=p_email AND removed_at IS NULL;
      action_name := 'admin.remove';
    END IF;
  END IF;
  INSERT INTO public.audit_events(actor_email,action,target_type,target_id,metadata)
    VALUES(p_actor,action_name,CASE WHEN p_operation IN ('promote','demote') THEN 'admin_allowlist' ELSE 'local_account' END,
           p_email,jsonb_build_object('via','app'));
END $$;
REVOKE ALL ON FUNCTION public.protocols_manage_local_account(text,integer,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.protocols_manage_local_account(text,integer,text,text,text) TO protocols_app;

CREATE FUNCTION public.protocols_change_local_password(p_email text,p_version integer,p_hash text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE next_version integer;
BEGIN
  PERFORM pg_advisory_xact_lock(7281946501);
  IF p_hash IS NULL OR p_hash !~ '^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$' THEN
    RAISE EXCEPTION 'A valid password hash is required.';
  END IF;
  UPDATE public.local_accounts l SET password_hash=p_hash, must_change_password=false,
    credential_version=credential_version+1, failed_login_count=0, locked_until=NULL,updated_at=now()
    WHERE l.email=p_email AND l.is_active AND l.credential_version=p_version
      AND NOT EXISTS(SELECT 1 FROM public.researcher_denylist d WHERE d.email=l.email AND d.removed_at IS NULL)
    RETURNING credential_version INTO next_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'Your session is no longer valid. Sign in again.' USING ERRCODE='42501'; END IF;
  INSERT INTO public.audit_events(actor_email,action,target_type,target_id,metadata)
    VALUES(p_email,'local-account.password-change','local_account',p_email,'{}');
  RETURN next_version;
END $$;
REVOKE ALL ON FUNCTION public.protocols_change_local_password(text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.protocols_change_local_password(text,integer,text) TO protocols_app;
