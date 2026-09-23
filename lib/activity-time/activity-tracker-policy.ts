// Two minutes stays comfortably below the database's minimum five-minute idle timeout while
// avoiding a request for every click/key interaction. The server timeout remains authoritative.
export const ACTIVITY_TOUCH_THROTTLE_MS = 2 * 60_000;

export function shouldSendActivityTouch({
  isVisible,
  lastSentAt,
  now,
}: {
  isVisible: boolean;
  lastSentAt: number | null;
  now: number;
}) {
  return isVisible && (lastSentAt === null || now - lastSentAt >= ACTIVITY_TOUCH_THROTTLE_MS);
}
