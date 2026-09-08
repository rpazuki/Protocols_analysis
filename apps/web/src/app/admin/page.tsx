import { redirect } from 'next/navigation';
import { appPath } from '../../lib/paths.ts';

export default function AdminIndexPage() {
  redirect(appPath('/admin/reports'));
}
