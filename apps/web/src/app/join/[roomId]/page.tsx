import { notFound } from "next/navigation";
import { isRoomId } from "@/shared/lib/room-id";
import { JoinView } from "@/views/join";

export default async function Page({ params, searchParams }: { params: Promise<{ roomId: string }>; searchParams: Promise<{ invite?: string }> }) {
  const { roomId } = await params;
  if (!isRoomId(roomId)) notFound(); // 서버가 만들 수 없는 모양이면 바로 없는 룸으로 안내한다.
  const { invite } = await searchParams;
  return <JoinView roomId={roomId} invite={invite ?? ""} />;
}
