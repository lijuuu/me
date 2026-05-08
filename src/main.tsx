import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ThemeToggle from "./components/ThemeToggle";
import LofiPlayer from "./components/LofiPlayer";
import AskChatGPT from "./components/AskChatGPT";
import BlogSearch from "./components/BlogSearch";
import ScrollRestore from "./components/ScrollRestore";
import Cat from "./components/Cat";
import Home from "./pages/Home";
import ProjectPage from "./pages/ProjectPage";
import "./styles/globals.css";

function App() {
  return (
    <BrowserRouter>
      <ThemeToggle />
      <LofiPlayer />
      <AskChatGPT />
      <BlogSearch />
      <ScrollRestore />
      <Cat />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/blog/:slug" element={<ProjectPage />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
