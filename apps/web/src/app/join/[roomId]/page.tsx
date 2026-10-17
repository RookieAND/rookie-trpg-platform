import { JoinView } from "@/views/join";

export default async function Page({ params, searchParams }: { params: Promise<{ roomId: string }>; searchParams: Promise<{ invite?: string }> }) {
  const { roomId } = await params;
  const { invite } = await searchParams;
  return <JoinView roomId={roomId} invite={invite ?? ""} />;
}
