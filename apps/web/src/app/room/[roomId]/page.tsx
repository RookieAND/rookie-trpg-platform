import { RoomView } from "@/views/room";

export default async function Page({ params, searchParams }: { params: Promise<{ roomId: string }>; searchParams: Promise<{ invite?: string }> }) {
  const { roomId } = await params;
  const { invite } = await searchParams;
  return <RoomView roomId={roomId} invite={invite} />;
}
