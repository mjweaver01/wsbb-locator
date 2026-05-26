import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <main className="loading-state">
      <span>Page not found</span>
      <Link to="/">Back to directory</Link>
    </main>
  );
}
