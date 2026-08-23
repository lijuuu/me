import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import Home from "./pages/Home";
import "./styles/globals.css";

const ProjectPage = lazy(() => import("./pages/ProjectPage"));
const CvPage = lazy(() => import("./pages/CvPage"));

function Chrome() {
  return null;
}

function App() {
  return (
    <BrowserRouter>
      <Analytics />
      <Chrome />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/blog/:slug" element={<ProjectPage />} />
          <Route path="/cv" element={<CvPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
