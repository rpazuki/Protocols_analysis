# Export Scripts

`export-cli.ts` produces the same CSV and JSONL exports as the admin UI, for scheduled or scripted runs on the VM and for exports too large to be comfortable in a browser.

```bash
node scripts/export/export-cli.ts --help
node scripts/export/export-cli.ts --format=csv --out=/srv/protocols/exports/reports.csv
node scripts/export/export-cli.ts --format=jsonl --from=2026-01-01 --to=2026-06-30
node scripts/export/export-cli.ts --include-recycled --researcher=name@ic.ac.uk
```

It applies the same rules as the web route:

- recycled records are excluded unless `--include-recycled` is given;
- permanently deleted records cannot be exported, because their content no longer exists;
- `EXPORT_MAX_ROWS` (default 100,000) is enforced before anything is written, so one scripted run cannot pull the whole lab record by accident;
- the `export.run` audit event is written **before the output file is opened**, and the export is abandoned if that write fails. A file on disk is a release of the lab record, so an unaudited one is the thing to prevent; if the file write then fails, what remains is an audited attempt rather than an unaudited release.

It differs from the web route in one way: there is no origin check, because there is no browser involved. Access control here is the VM's — anyone who can run this script already has the database credentials.

**The output contains raw Imperial email addresses**, which are personal data. Write it to lab-controlled storage, and delete it when the analysis is finished. See [gdpr-position.md](../../docs/privacy-security/gdpr-position.md) before sharing an export outside the lab.
