import Link from "next/link";

export default function CvPage() {
  return (
    <>
      <div className="fixed top-4 left-4 right-4 z-50 flex items-center justify-between lowercase">
        <Link href="/" className="text-xs text-[#6b6b6b] hover:text-[#111111] lowercase">&larr; home</Link>
        <a href="/cv.pdf" download className="text-xs text-[#111111] underline underline-offset-2">download &darr;</a>
      </div>
      <iframe
        src="/cv.pdf"
        className="fixed inset-0 top-14 w-full border-0"
        style={{ height: "calc(100vh - 56px)" }}
      />
    </>
  );
}
