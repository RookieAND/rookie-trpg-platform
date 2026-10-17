import type { Library } from "@coc-vtt/shared";

/** 사용자 한 명의 개인 서재(매크로·직업 정의)를 통째로 읽고 쓰는 저장소(포트). */
export interface LibraryRepository {
  load(userId: string): Promise<Library | null>;
  save(userId: string, library: Library): Promise<void>;
}
