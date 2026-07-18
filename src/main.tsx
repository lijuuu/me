import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import GenerativeBackground from "./components/GenerativeBackground";
import Home from "./pages/Home";
import ProjectPage from "./pages/ProjectPage";
import CvPage from "./pages/CvPage";
import "./styles/globals.css";

function Chrome() {
  return null;
}

function App() {
  return (
    <BrowserRouter>
      <Analytics />
      <GenerativeBackground />
      <Chrome />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/blog/:slug" element={<ProjectPage />} />
        <Route path="/cv" element={<CvPage />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
