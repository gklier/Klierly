import { PasskeyForm } from "@/components/passkey-form";
export const metadata = { title: "Set up your passkey", robots: { index: false, follow: false } };
export default function EnrollPage() {
  return <><h1 className="text-2xl font-semibold">Set up your Klierly passkey</h1><p className="mt-3">Use your device’s screen lock or a security key. Keep the enrollment link private. It expires after 24 hours and works once.</p><PasskeyForm enroll /></>;
}
