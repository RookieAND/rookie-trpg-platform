/** 서버가 만드는 룸 id의 모양(영문·숫자·_·-, 64자 이하). 이 모양이 아니면 서버에 물어볼 것도 없이 없는 룸이다. */
export const isRoomId = (id: string): boolean => /^[A-Za-z0-9_-]{1,64}$/.test(id);
