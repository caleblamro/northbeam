import { redirect } from 'next/navigation';

// The read-only permission matrix was replaced by the Directus-style roles
// editor. Keep the old path working for bookmarks.
export default function PermissionsSetupPage() {
  redirect('/setup/roles');
}
