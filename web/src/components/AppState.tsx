import { AlertTriangle } from "lucide-react";
import { HeroSection } from "@/components/HeroSection";

export function LoadingState() {
  return (
    <>
      <HeroSection />
      <div className="loading-state">Loading coaches…</div>
    </>
  );
}

interface ErrorStateProps {
  message: string;
}

export function ErrorState({ message }: ErrorStateProps) {
  return (
    <>
      <HeroSection />
      <div className="error-state">
        <AlertTriangle size={20} strokeWidth={1.5} />
        <span>{message}</span>
        <span style={{ fontSize: 12 }}>
          Check the API service logs and VITE_API_URL.
        </span>
      </div>
    </>
  );
}
