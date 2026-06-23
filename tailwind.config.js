/** @type {import('tailwindcss').Config} */
import trac from "tailwindcss-react-aria-components";
import contQueries from "@tailwindcss/container-queries";

export default {
  content: ["./index.html", "./download.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    // -----------------------------------------------------------------------
    // fontSize — xs地雷(0.4rem)を正常スケールへ。キーキャップ専用は text-keycap
    // -----------------------------------------------------------------------
    fontSize: {
      "2xs": ["0.75rem", { lineHeight: "1.3" }],
      xs:    ["0.78125rem", { lineHeight: "1.33" }],
      sm:    ["0.875rem", { lineHeight: "1.42" }],
      base:  ["1rem", { lineHeight: "1.52" }],
      lg:    ["1.15625rem", { lineHeight: "1.42" }],
      xl:    ["1.28125rem", { lineHeight: "1.33" }],
      "2xl": ["1.4375rem", { lineHeight: "1.28" }],
      keycap: ["0.4rem", { lineHeight: "1" }],
    },
    // -----------------------------------------------------------------------
    // fontFamily — 全体はInter + 日本語フォント
    // -----------------------------------------------------------------------
    fontFamily: {
      sans: [
        "Inter",
        "Hiragino Sans",
        "Hiragino Kaku Gothic ProN",
        "Noto Sans JP",
        "system-ui",
        "sans-serif",
      ],
      keycap: ["Inter", "system-ui"],
    },
    extend: {
      // -----------------------------------------------------------------------
      // colors — warm neutral (Notion風) + くすみエメラルド accent
      // light-dark() 方式維持: OS追従、手動トグル不要
      // -----------------------------------------------------------------------
      colors: {
        // 面(背景の層)
        "base-100": "light-dark(#ffffff, #212121)",
        "base-200": "light-dark(#f7f7f5, #181818)",
        "base-300": "light-dark(#f2f1ee, #2a2a2a)",

        // 文字 — ダークモードは純白に寄せず、ウォームグレーでコントラストを和らげる
        // (真っ白だと暗背景で眩しく読みにくい、というオーナー指摘への対応)
        "base-content": "light-dark(#2a2a28, #cdccc6)",
        muted:          "light-dark(#72726d, #9a9a95)",

        // 枠線
        border: "light-dark(#e2e1dd, #373737)",

        // アクセント: くすみエメラルド
        primary:         "light-dark(#2e8b67, #4fb08c)",
        "primary-content": "light-dark(#ffffff, #10231b)",

        // セマンティック
        success: "light-dark(#2f7a4f, #5c9b74)",
        danger:  "light-dark(#a74f4f, #bc6d6d)",
        warn:    "light-dark(#9a5c24, #c49060)",
        error:   "light-dark(#a74f4f, #bc6d6d)",

        // secondary / accent: 既存キー維持、彩度を落としてウォームトーンに合わせる
        secondary: "light-dark(#7a6b8a, #a090b5)",
        accent:    "light-dark(#5a8a7a, #74aba0)",
      },

      // -----------------------------------------------------------------------
      // borderColor.DEFAULT を border トークンと整合させる
      // -----------------------------------------------------------------------
      borderColor: {
        DEFAULT: "light-dark(#e2e1dd, #373737)",
      },

      // divideColor も同様
      divideColor: {
        DEFAULT: "light-dark(#e2e1dd, #373737)",
      },
    },
  },
  plugins: [contQueries, trac({ prefix: "rac" })],
};
