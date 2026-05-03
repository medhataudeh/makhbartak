"use client";
import { Component, type ReactNode } from "react";

// Class-component error boundary so the nurse page never blank-screens on
// an unexpected runtime error. React's hooks API doesn't expose
// componentDidCatch, so this stays as a small class. Logs to console for
// the operator + offers a "إعادة المحاولة" button without a page reload.
interface State { error: Error | null }

export class NurseErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("[NurseApp] crash", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-sm w-full bg-white rounded-2xl border border-gray-100 p-6 text-center space-y-3">
          <p className="text-sm font-bold text-[#164E63]">حدث خطأ في تحميل صفحة الممرض</p>
          <p className="text-xs text-gray-500 leading-relaxed">
            تعذر عرض البيانات. حاول مرة أخرى أو سجّل الدخول من جديد.
          </p>
          <p className="text-[10px] text-gray-400 lat" dir="ltr">
            {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="w-full h-11 rounded-xl bg-[#0891B2] text-white text-sm font-semibold cursor-pointer active:bg-[#0E7490]"
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }
}
