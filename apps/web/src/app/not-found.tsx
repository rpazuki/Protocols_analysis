import Link from 'next/link';

export default function NotFound() {
  return (
    <>
      <div className="page-header">
        <h1>Not found</h1>
      </div>
      <div className="notice notice--warning">
        <p>
          That page or report does not exist, or you do not have access to it. If a colleague sent
          you the link, they may have been looking at their own report.
        </p>
      </div>
      <Link className="btn btn--primary" href="/reports">
        Back to my reports
      </Link>
    </>
  );
}
