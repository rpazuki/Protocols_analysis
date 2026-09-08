# TLS Certificate Request Notes

This note is for resolving the browser "not trusted" warning on:

`https://rlalab-assist.dept.ic.ac.uk/`

## What The Warning Usually Means

A browser trust warning usually means one of these is true:

- the server is using a self-signed certificate;
- the certificate is issued to a different hostname;
- the certificate chain is incomplete, usually missing an intermediate certificate;
- the certificate is expired;
- the certificate was issued by an internal CA that the user's device does not trust.

For the lab gateway, the target is a publicly trusted or Imperial-managed certificate whose subject names include:

`rlalab-assist.dept.ic.ac.uk`

## Imperial Route

Imperial's SSL certificate guidance says all Imperial websites should be secured with SSL/TLS and that new certificate requests should go through the certificate request form. Requests are triaged for suitability for ICT's F5 Load Balancer Service.

Imperial's page also says:

- ICT recommends the F5 Load Balancer Service for websites hosted in an ICT-managed datacentre;
- F5 can terminate TLS and auto-renew SSL certificates every 3 months;
- if a website cannot use F5, certificate renewal automation is needed;
- for Linux web servers that cannot use F5, Imperial recommends Let's Encrypt certificates generated and renewed automatically by certbot;
- support and advice should go through the Hybrid Cloud team via ASK.

## Recommendation For This VM

Ask ICT/Hybrid Cloud for one of these, in order:

1. **Preferred:** put `rlalab-assist.dept.ic.ac.uk` behind the ICT F5 Load Balancer Service, with F5 terminating TLS on port `443` and forwarding to the VM gateway internally.
2. **Fallback:** approve and document Let's Encrypt/certbot automation on the Red Hat VM for `rlalab-assist.dept.ic.ac.uk`.
3. **Manual fallback:** issue a server certificate and full certificate chain for manual installation on the gateway reverse proxy. This should be a last resort because short certificate validity makes manual renewal fragile.

For path routing, a single-host certificate is enough:

`rlalab-assist.dept.ic.ac.uk`

A wildcard certificate is not required for `/protocols`, `/biopipeline`, and `/assist`. If ICT says a wildcard or SAN certificate is easy and useful for future subdomains, keep the scope narrow, for example:

`*.rlalab-assist.dept.ic.ac.uk`

Do not request a broad departmental wildcard unless ICT specifically recommends it.

## Information To Provide In The ASK Request

Imperial's public page does not expose the exact ASK form fields, but this is the information to have ready.

### Service Identity

- Service name: `RLA Lab Apps Gateway`.
- Primary hostname: `rlalab-assist.dept.ic.ac.uk`.
- Requested public URL: `https://rlalab-assist.dept.ic.ac.uk/`.
- Public routes: `/protocols` for Protocols, `/biopipeline` for bioPipeline, `/assist` for rlalab-assist.
- Network exposure: VPN/Zscaler only.
- Owning lab/department: to confirm.
- Named service owner: to confirm.
- Technical contact: to confirm.

### Hosting Details

- Hosting model: Imperial-managed Red Hat Linux VM.
- Runtime: Docker Server.
- Gateway software: to confirm, for example nginx, Apache, Caddy, Traefik, or ICT-managed F5.
- Backend applications listen only on internal or loopback ports.
- Public ports requested: `80` redirecting to `443`; `443` serving HTTPS.
- Internal backend ports may include `3000`, `3001`, `3002`, or `8080`, but they should not be user-facing.

### Certificate Details

- Certificate common name / primary DNS name: `rlalab-assist.dept.ic.ac.uk`.
- Subject alternative names: `rlalab-assist.dept.ic.ac.uk`; add future names only if ICT wants SAN/subdomain flexibility.
- Certificate type: server authentication TLS certificate.
- Desired termination point: preferably ICT F5; otherwise VM reverse proxy.
- Renewal preference: automated renewal.
- If not using F5: confirm whether certbot/Let's Encrypt is approved for this host and whether HTTP-01 or DNS-01 validation should be used.
- If manual certificate issuance is required: generate a 2048-bit RSA private key and CSR on the production VM. Submit only the `.csr` file to ICT; never send the private key.

## Producing The 2048-Bit CSR On The Production VM

Generate the CSR on the production VM, not on a laptop or development machine. The private key created at the same time must remain on the production VM, because it is the secret that matches the certificate ICT will issue.

Recommended RHEL locations:

- private key: `/etc/pki/tls/private/rlalab-assist.dept.ic.ac.uk.key`
- CSR to send to ICT: `/etc/pki/tls/csr/rlalab-assist.dept.ic.ac.uk.csr`
- signed certificate returned by ICT later: `/etc/pki/tls/certs/rlalab-assist.dept.ic.ac.uk.crt`
- intermediate/full chain returned by ICT later: `/etc/pki/tls/certs/rlalab-assist.dept.ic.ac.uk-chain.pem`

Run this on the production VM:

```bash
sudo install -d -m 700 -o root -g root /etc/pki/tls/private
sudo install -d -m 755 -o root -g root /etc/pki/tls/csr

sudo openssl req -new -newkey rsa:2048 -nodes \
  -keyout /etc/pki/tls/private/rlalab-assist.dept.ic.ac.uk.key \
  -out /etc/pki/tls/csr/rlalab-assist.dept.ic.ac.uk.csr \
  -subj "/C=GB/ST=London/L=London/O=Imperial College London/OU=<department-or-lab>/CN=rlalab-assist.dept.ic.ac.uk" \
  -addext "subjectAltName=DNS:rlalab-assist.dept.ic.ac.uk"

sudo chmod 600 /etc/pki/tls/private/rlalab-assist.dept.ic.ac.uk.key
sudo chmod 644 /etc/pki/tls/csr/rlalab-assist.dept.ic.ac.uk.csr
```

Replace `<department-or-lab>` with the exact department, centre, or lab name ICT wants in the certificate subject. The modern browser-critical identity field is the SAN value, so make sure `DNS:rlalab-assist.dept.ic.ac.uk` is present.

Check the CSR before sending it:

```bash
sudo openssl req -in /etc/pki/tls/csr/rlalab-assist.dept.ic.ac.uk.csr -noout -subject
sudo openssl req -in /etc/pki/tls/csr/rlalab-assist.dept.ic.ac.uk.csr -noout -text | grep -A1 "Subject Alternative Name"
```

Send ICT the CSR file:

```text
/etc/pki/tls/csr/rlalab-assist.dept.ic.ac.uk.csr
```

Do not send this file:

```text
/etc/pki/tls/private/rlalab-assist.dept.ic.ac.uk.key
```

If ICT/F5 will terminate TLS rather than the VM reverse proxy, confirm whether they still want a CSR generated on the VM. In a true F5-terminated setup, the private key usually belongs at the TLS termination point, not inside the application containers.

## Installing The Issued `.cer` And `.p7b` Files

Install the certificate on the component that terminates HTTPS. In the current VM-gateway model, that is the reverse proxy on the production VM. If TLS is later terminated by Imperial F5, install the certificate and private key according to ICT's F5 process instead.

Assumptions:

- ICT returned a site certificate file, usually `.cer`;
- ICT returned a CA bundle file, usually `.p7b`;
- the matching private key is still on the production VM at `/etc/pki/tls/private/rlalab-assist.dept.ic.ac.uk.key`.

Copy the ICT files onto the production VM, then convert/check them:

```bash
sudo install -d -m 755 -o root -g root /etc/pki/tls/certs

cd /etc/pki/tls/certs

# Convert the site certificate to PEM if needed.
sudo openssl x509 \
  -in /path/to/ICT-returned-site-certificate.cer \
  -out rlalab-assist.dept.ic.ac.uk.crt

# If the command above fails, the .cer may be DER encoded:
sudo openssl x509 -inform DER \
  -in /path/to/ICT-returned-site-certificate.cer \
  -out rlalab-assist.dept.ic.ac.uk.crt

# Extract the CA/intermediate certificates from the PKCS#7 bundle.
sudo openssl pkcs7 -print_certs \
  -in /path/to/ICT-returned-ca-bundle.p7b \
  -out imperial-private-ca-bundle.pem

# If the command above fails, the .p7b may be DER encoded:
sudo openssl pkcs7 -inform DER -print_certs \
  -in /path/to/ICT-returned-ca-bundle.p7b \
  -out imperial-private-ca-bundle.pem
```

Build a full chain file for web servers that expect the site certificate and intermediate bundle together:

```bash
sudo cp rlalab-assist.dept.ic.ac.uk.crt rlalab-assist.dept.ic.ac.uk-fullchain.pem
sudo sh -c 'cat /etc/pki/tls/certs/imperial-private-ca-bundle.pem >> /etc/pki/tls/certs/rlalab-assist.dept.ic.ac.uk-fullchain.pem'
sudo chmod 644 /etc/pki/tls/certs/rlalab-assist.dept.ic.ac.uk*.pem /etc/pki/tls/certs/rlalab-assist.dept.ic.ac.uk.crt
```

Check that the issued certificate matches the private key created with the CSR:

```bash
sudo openssl x509 -in /etc/pki/tls/certs/rlalab-assist.dept.ic.ac.uk.crt -pubkey -noout \
  | openssl pkey -pubin -outform der \
  | openssl dgst -sha256

sudo openssl pkey -in /etc/pki/tls/private/rlalab-assist.dept.ic.ac.uk.key -pubout -outform der \
  | openssl dgst -sha256
```

The two SHA256 hashes must match. If they do not, the certificate was not issued for this private key and the web server will not start correctly.

For nginx-style TLS termination, configure:

```nginx
ssl_certificate     /etc/pki/tls/certs/rlalab-assist.dept.ic.ac.uk-fullchain.pem;
ssl_certificate_key /etc/pki/tls/private/rlalab-assist.dept.ic.ac.uk.key;
```

Then check and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

For Apache/httpd-style TLS termination, configure the vhost with:

```apache
SSLCertificateFile /etc/pki/tls/certs/rlalab-assist.dept.ic.ac.uk.crt
SSLCertificateKeyFile /etc/pki/tls/private/rlalab-assist.dept.ic.ac.uk.key
SSLCertificateChainFile /etc/pki/tls/certs/imperial-private-ca-bundle.pem
```

Then check and reload:

```bash
sudo apachectl configtest
sudo systemctl reload httpd
```

If SELinux is enforcing, restore standard certificate file contexts:

```bash
sudo restorecon -Rv /etc/pki/tls/certs /etc/pki/tls/private
```

ICT's note says that if the server is not bound to the Imperial Active Directory domain, the CA bundle may need to be imported into the server or web server trust store. On RHEL, import only the Imperial CA certificates, not the private key:

```bash
sudo cp /etc/pki/tls/certs/imperial-private-ca-bundle.pem /etc/pki/ca-trust/source/anchors/imperial-private-ca-bundle.pem
sudo update-ca-trust extract
```

This server-side trust-store step is separate from browser trust. A user's browser also needs to trust the Imperial Private CA. Imperial-managed, domain-bound devices may already do this; unmanaged personal devices may still show a warning unless the Imperial Private CA is installed and trusted on the client.

Verify the live service from the VM and from a browser over VPN/Zscaler:

```bash
openssl s_client -connect rlalab-assist.dept.ic.ac.uk:443 -servername rlalab-assist.dept.ic.ac.uk -showcerts
curl -I https://rlalab-assist.dept.ic.ac.uk/
```

After verification, reply to ICT confirming the certificate is installed and whether users still see trust warnings from unmanaged devices.

### Security And Compliance Context

- The site fronts three internal lab web apps.
- Protocols will use Imperial SSO and stores researcher email addresses as personal data.
- TLS is needed before SSO production registration because Entra/OIDC redirect URIs require HTTPS outside localhost, and users should not see trust warnings.
- The gateway should strip any client-supplied identity headers before forwarding to backend apps.
- The VM is VPN/Zscaler-only, but TLS and SSO are still required.

## Copy-Paste Certificate Request Text

Hello ICT / Hybrid Cloud team,

We need help resolving the HTTPS certificate trust warning for an Imperial-managed Red Hat Linux VM that will host a small multi-application lab gateway.

Requested public URL:

`https://rlalab-assist.dept.ic.ac.uk/`

Primary hostname:

`rlalab-assist.dept.ic.ac.uk`

The VM is reachable only via Imperial VPN/Zscaler. We want a single HTTPS entry point on port `443`, with port `80` redirecting to HTTPS. The gateway will route internally to Docker-hosted apps at path prefixes `/protocols` for Protocols, `/biopipeline` for bioPipeline, and `/assist` for rlalab-assist. Backend app ports such as `3000`, `3001`, `3002`, or `8080` will be internal only and should not be exposed publicly.

Please advise whether this service is suitable for the ICT F5 Load Balancer Service with managed TLS and automatic certificate renewal. If so, we would like F5 to terminate TLS for `rlalab-assist.dept.ic.ac.uk` and forward traffic to the VM gateway.

If F5 is not suitable, please confirm the approved certificate approach for this Linux VM. Imperial's SSL guidance recommends Let's Encrypt with certbot for Linux web servers that cannot use F5, so please confirm whether certbot automation is acceptable for this host and which validation method should be used. If a manually issued certificate is required instead, please tell us whether you need a CSR and what key type/size and subject alternative names you require.

For path routing, one certificate for `rlalab-assist.dept.ic.ac.uk` is sufficient. If ICT prefers issuing a narrow wildcard or SAN certificate for future subdomain flexibility, please advise on the approved scope.

This certificate work is also a prerequisite for the Protocols SSO request, because the SSO callback will be under the same HTTPS gateway.

## Questions For ICT

1. Can this VM use the ICT F5 Load Balancer Service?
2. If yes, what backend address/port should the VM gateway expose to F5?
3. If no, is Let's Encrypt/certbot approved for this RHEL VM?
4. Which validation method should be used: HTTP-01 through port 80, DNS-01, or another ICT-approved route?
5. Should the certificate cover only `rlalab-assist.dept.ic.ac.uk`, or should it include SAN/wildcard names for future subdomain routing?
6. If a CSR is needed, what subject fields, key type, and key size should be used?
7. Does ICT require any specific reverse proxy or TLS settings, such as HSTS, TLS versions, ciphers, or certificate-chain file layout?

## Sources Checked

- [Imperial SSL Certificates](https://www.imperial.ac.uk/admin-services/ict/self-service/connect-communicate/hosting-and-storage/ssl-certificates-/): certificate requests go through the certificate request form; requests are triaged for F5; Linux servers that cannot use F5 should use Let's Encrypt/certbot automation.
- [Imperial Hosting and Storage](https://www.imperial.ac.uk/admin-services/ict/self-service/connect-communicate/hosting-and-storage/): hosting services include servers, websites, databases, and SSL certificates.
- [Imperial Servers](https://www.imperial.ac.uk/admin-services/ict/self-service/connect-communicate/hosting-and-storage/servers/): Imperial provisions Linux servers on Red Hat Enterprise Linux and handles server ownership/access through ICT Service Desk.
- [Imperial ICT Service Desk](https://www.imperial.ac.uk/admin-services/ict/contact-ict-service-desk/): ASK / ICT Service Desk is the support route.
