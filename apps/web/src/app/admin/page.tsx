import { redirect } from 'next/navigation';
import { appUrl } from '../../server/urls.ts';

export default function AdminIndexPage() {
  redirect(appUrl('/admin/reports'));
}
