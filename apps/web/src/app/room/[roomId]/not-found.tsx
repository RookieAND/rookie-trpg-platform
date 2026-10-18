import { ErrorPanel } from "@/shared/ui";

export default function RoomNotFound() {
  return <ErrorPanel title="룸을 찾을 수 없어요" description="링크가 잘못됐거나 룸이 지워졌을 수 있어요. 링크를 다시 확인해 주세요." />;
}
