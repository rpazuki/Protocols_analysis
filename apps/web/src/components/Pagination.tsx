import Link from 'next/link';

/** Server-rendered pagination that preserves the current filter query string. */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const href = (target: number): string => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) query.set(key, value);
    }
    query.set('page', String(target));
    return `${basePath}?${query.toString()}`;
  };

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav className="pagination" aria-label="Pagination">
      {page > 1 ? (
        <Link className="btn btn--sm" href={href(page - 1)}>
          Previous
        </Link>
      ) : null}
      <span>
        {first}-{last} of {total}
      </span>
      {page < lastPage ? (
        <Link className="btn btn--sm" href={href(page + 1)}>
          Next
        </Link>
      ) : null}
    </nav>
  );
}
