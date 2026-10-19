"use client";
import { limitMessage } from "@/shared/lib";

/**
 * 입력이 한도에 닿으면 칸 이름을 넣은 한 문장으로 알린다("핸드아웃 제목은 60자까지예요.").
 * maxLength가 더 입력하지 못하게 막으므로, 막힌 이유가 조용히 사라지지 않게 하는 안내다.
 */
export function LimitNote({ label, max, value, id }: { label: string; max: number; value: string; id?: string }) {
  if (value.length < max) return null;
  return (
    <span className="limit-note" id={id} role="status" data-testid="limit-note">
      {limitMessage(label, max)}
    </span>
  );
}
