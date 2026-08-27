/** 이름 대조 - 엑셀에서 읽은 이름을 실제 명단의 이름으로 맞춰준다 */

const CLOSED_WORDS = ['휴무', '휴관', '휴', '-', '없음', 'x', 'X']

export function isClosedText(raw: string): boolean {
  const s = raw.replace(/\s/g, '')
  return CLOSED_WORDS.includes(s)
}

export function normalize(raw: string): string {
  return raw.replace(/\s/g, '').replace(/[()（）]/g, '').trim()
}

/** 두 이름의 글자 단위 편집 거리 */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
  }
  return dp[a.length][b.length]
}

export type NameMatch =
  | { kind: 'closed' }
  | { kind: 'empty' }
  | { kind: 'exact'; name: string }
  | { kind: 'guess'; name: string; input: string }
  | { kind: 'unknown'; input: string }

/**
 * 읽어들인 이름 하나를 명단과 대조한다.
 * - 정확히 같으면 exact
 * - 한 글자 차이면 guess (화면에서 노랗게 표시하고 사람이 확인)
 * - 그 외에는 unknown (빨갛게 표시)
 */
export function matchName(raw: string, roster: string[]): NameMatch {
  const input = normalize(raw ?? '')
  if (!input) return { kind: 'empty' }
  if (isClosedText(input)) return { kind: 'closed' }

  const exact = roster.find((n) => normalize(n) === input)
  if (exact) return { kind: 'exact', name: exact }

  let best: string | null = null
  let bestDistance = Infinity
  for (const n of roster) {
    const d = editDistance(input, normalize(n))
    if (d < bestDistance) {
      bestDistance = d
      best = n
    }
  }
  // 세 글자 이름에서 한 글자 차이까지만 추측으로 인정한다
  if (best && bestDistance <= 1) return { kind: 'guess', name: best, input }
  return { kind: 'unknown', input }
}
