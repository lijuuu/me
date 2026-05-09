import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import ThemeToggle from "./components/ThemeToggle";
import LofiPlayer from "./components/LofiPlayer";
import AskChatGPT from "./components/AskChatGPT";
import BlogSearch from "./components/BlogSearch";
import ScrollRestore from "./components/ScrollRestore";
import Cat from "./components/Cat";
import Home from "./pages/Home";
import ProjectPage from "./pages/ProjectPage";
import CvPage from "./pages/CvPage";
import "./styles/globals.css";

function Chrome() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLElement && e.target.isContentEditable) return;
      if (e.key === "h") navigate("/");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigate]);
  if (pathname === "/cv") return null;
  return (
    <>
      <ThemeToggle />
      <LofiPlayer />
      <AskChatGPT />
      <BlogSearch />
      <ScrollRestore />
      <Cat />
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
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
