import { Link } from "react-router-dom";

export default function CvPage() {
  return (
    <>
      <div className="fixed top-4 left-4 right-4 z-50 flex items-center justify-between lowercase">
        <Link to="/" className="text-xs text-[#4a5578] hover:text-[#64b5f6] lowercase">&larr; home</Link>
        <a href="/cv.pdf" download className="text-xs text-[#64b5f6] underline underline-offset-2">download &darr;</a>
      </div>
      <iframe
        src="/cv.pdf"
        className="fixed inset-0 top-14 w-full border-0"
        style={{ height: "calc(100vh - 56px)" }}
      />
    </>
  );
}
