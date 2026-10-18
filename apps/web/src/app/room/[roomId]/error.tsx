"use client";
import { useEffect } from "react";
import { ErrorPanel } from "@/shared/ui";

/**
 * 룸 화면에서 예외가 나면 이 룸 화면만 걷어 낸다. 룸 화면이 사라지면 접속(웹소켓)도 함께 닫히므로
 * 반쯤 깨진 화면이 연결만 붙들고 있는 일이 없다. "다시 시도"는 룸을 처음부터 불러와 다시 접속한다.
 * 룸의 진행 내용은 서버에 있어서 화면이 깨져도 사라지지 않는다.
 */
export default function RoomError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ErrorPanel
      title="룸 화면에 문제가 생겼어요"
      description="연결을 정리했어요. 다시 시도하면 룸을 처음부터 불러와요. 진행 내용은 서버에 그대로 있어요."
      onRetry={reset}
      digest={error.digest}
    />
  );
}
