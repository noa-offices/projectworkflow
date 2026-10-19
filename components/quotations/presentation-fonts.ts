import { Cormorant_Garamond, DM_Sans } from "next/font/google";

// Presentation-only typefaces. Exposed as CSS variables and applied solely inside `.presentation-theme`,
// so the app-wide Geist setup in app/layout.tsx stays untouched.
export const presentationSerif = Cormorant_Garamond({
  variable: "--font-presentation-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const presentationSans = DM_Sans({
  variable: "--font-presentation-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});
