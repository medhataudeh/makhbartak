"use client";
import { NurseApp } from "@/components/nurse/NurseApp";
import { NurseErrorBoundary } from "@/components/nurse/NurseErrorBoundary";

export default function NursePage() {
  return (
    <NurseErrorBoundary>
      <NurseApp />
    </NurseErrorBoundary>
  );
}
