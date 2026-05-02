import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#ECFEFF",
          100: "#CFFAFE",
          200: "#A5F3FC",
          300: "#67E8F9",
          400: "#22D3EE",
          500: "#06B6D4",
          600: "#0891B2",
          700: "#0E7490",
          800: "#155E75",
          900: "#164E63",
          DEFAULT: "#0891B2",
        },
        emerald: {
          50: "#ECFDF5",
          500: "#10B981",
          600: "#059669",
          700: "#047857",
        },
        surface: "#ECFEFF",
        "text-primary": "#164E63",
        "text-secondary": "#0E7490",
        "text-muted": "#6B7280",
        "border-light": "#E0F7FA",
        success: "#059669",
        warning: "#D97706",
        error: "#DC2626",
        "status-created": "#6B7280",
        "status-confirmed": "#0891B2",
        "status-on-way": "#7C3AED",
        "status-collected": "#059669",
        "status-ready": "#065F46",
        "status-cancelled": "#DC2626",
        "status-issue": "#D97706",
      },
      fontFamily: {
        sans: ["var(--font-readex)", "Readex Pro", "Segoe UI", "Arial", "sans-serif"],
        arabic: ["var(--font-readex)", "Readex Pro", "Segoe UI", "Arial", "sans-serif"],
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
        "4xl": "2rem",
      },
      boxShadow: {
        soft: "0 2px 15px -3px rgba(8, 145, 178, 0.08), 0 4px 6px -4px rgba(8, 145, 178, 0.06)",
        card: "0 1px 3px rgba(0,0,0,0.05), 0 4px 12px rgba(8,145,178,0.08)",
        "card-hover": "0 4px 20px rgba(8,145,178,0.15), 0 1px 3px rgba(0,0,0,0.08)",
        sheet: "0 -4px 24px rgba(0,0,0,0.12)",
        cta: "0 4px 14px rgba(5, 150, 105, 0.35)",
      },
      animation: {
        "slide-up": "slideUp 0.35s cubic-bezier(0.32, 0.72, 0, 1)",
        "slide-down": "slideDown 0.25s cubic-bezier(0.4, 0, 1, 1)",
        "fade-in": "fadeIn 0.2s ease-out",
        "fade-out": "fadeOut 0.15s ease-in",
        "scale-in": "scaleIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
        "bounce-gentle": "bounceGentle 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
        shimmer: "shimmer 1.5s infinite linear",
        "pulse-soft": "pulseSoft 2s infinite",
        "check-draw": "checkDraw 0.4s ease-out forwards",
      },
      keyframes: {
        slideUp: {
          "0%": { transform: "translateY(100%)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        slideDown: {
          "0%": { transform: "translateY(0)", opacity: "1" },
          "100%": { transform: "translateY(100%)", opacity: "0" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        fadeOut: {
          "0%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
        scaleIn: {
          "0%": { transform: "scale(0.9)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        bounceGentle: {
          "0%": { transform: "scale(0.8)" },
          "60%": { transform: "scale(1.05)" },
          "100%": { transform: "scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
        checkDraw: {
          "0%": { strokeDashoffset: "100" },
          "100%": { strokeDashoffset: "0" },
        },
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        "ease-spring": "cubic-bezier(0.32, 0.72, 0, 1)",
      },
    },
  },
  plugins: [],
};
export default config;
