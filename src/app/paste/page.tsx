import { createPaste } from "./actions";
import MyPastes from "../../components/MyPastes";

export const metadata = { title: "paste — liju thomas" };

export default function PastePage() {
  return (
    <main className="relative z-10 max-w-screen-md px-6 sm:px-8 pt-16 pb-16 flex flex-col gap-6 lowercase">
      <a href="/" className="fixed top-4 left-4 z-40 text-xs text-[#6b6b6b] lowercase hover:text-[#111111]">← home</a>

      <form action={createPaste} className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight text-[#111111]">paste</h1>
          <div className="flex gap-4 text-xs text-[#444444]">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="type" value="markdown" defaultChecked /> markdown
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="type" value="code" /> code
            </label>
          </div>
        </div>

        <textarea
          name="content"
          required
          rows={26}
          placeholder="paste content here..."
          className="w-full text-[13px] font-mono leading-relaxed text-[#111111] bg-white/40 border border-black/10 rounded-sm p-4 focus:outline-none focus:border-black/25"
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-[#6b6b6b]">
            <label htmlFor="expiry">expires after</label>
            <select
              id="expiry"
              name="expiry"
              defaultValue="7d"
              className="bg-transparent border border-black/10 rounded-sm px-2 py-1 text-[#111111]"
            >
              <option value="1h">1 hour</option>
              <option value="1d">1 day</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
            </select>
          </div>

          <button
            type="submit"
            className="text-xs text-[#111111] border border-black/20 rounded-sm px-4 py-1.5 hover:bg-black/5"
          >
            create paste
          </button>
        </div>
      </form>

      <MyPastes />
    </main>
  );
}
