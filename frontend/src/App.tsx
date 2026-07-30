import { Routes, Route, Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Landing } from "./pages/Landing";
import { Court } from "./pages/Court";

function NotFound() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        textAlign: "center",
        padding: "24px",
      }}
    >
      <div>
        <p className="eyebrow">404</p>
        <h1 style={{ fontSize: "var(--t-h2)", margin: "16px 0" }}>This timeline doesn't exist.</h1>
        <Link to="/" className="btn">
          Back to the start
        </Link>
      </div>
    </div>
  );
}

export function App() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/court" element={<Court />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
