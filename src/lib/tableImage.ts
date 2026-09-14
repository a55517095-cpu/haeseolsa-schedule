/**
 * 전체 근무표를 그림(PNG) 한 장으로 만든다.
 * 화면의 표는 옆으로 밀려 있어 캡처로는 일부만 담기므로, 캔버스에 처음부터 새로 그린다.
 */

const FONT = `'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', system-ui, sans-serif`

export type ImageCell = {
  text: string
  closed?: boolean
  /** 바뀐 근무 (초록 글씨) */
  changed?: boolean
  /** 최초 근무표에서, 이후에 바뀐 칸 (밑줄) */
  later?: boolean
}

export type ImageRow = { label: string; weekday: number; cells: (ImageCell | null)[] }

const COLOR = {
  ink: '#16181d',
  soft: '#5b6472',
  line: '#d6dae1',
  strong: '#b3bac4',
  head: '#eef1f6',
  dateBg: '#f7f9fc',
  closedBg: '#e8eaee',
  ok: '#15803d',
  warn: '#b45309',
  sat: '#1d4ed8',
  sun: '#c0271c',
}

export function renderScheduleImage(opts: {
  title: string
  stamp: string
  legend: string
  posts: string[]
  rows: ImageRow[]
}): Blob {
  const SCALE = 2
  const PAD = 24
  const TITLE_H = 60
  const HEAD_H = 50
  const ROW_H = 38
  const FOOT_H = 44
  const DATE_W = 118

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('이 기기에서는 그림을 만들 수 없습니다.')

  // 근무지 이름이 한 줄에 들어가도록 칸 폭을 정한다
  ctx.font = `800 17px ${FONT}`
  const colW = Math.max(92, ...opts.posts.map((p) => Math.ceil(ctx.measureText(p).width) + 20))

  const tableW = DATE_W + colW * opts.posts.length
  const width = PAD * 2 + tableW
  const height = PAD * 2 + TITLE_H + HEAD_H + ROW_H * opts.rows.length + FOOT_H

  // 크기를 정하면 그리기 설정이 초기화되므로 그 뒤에 배율을 건다
  canvas.width = width * SCALE
  canvas.height = height * SCALE
  ctx.scale(SCALE, SCALE)
  ctx.textBaseline = 'middle'

  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)

  // 제목과 기준 시각
  ctx.textAlign = 'left'
  ctx.fillStyle = COLOR.ink
  ctx.font = `800 26px ${FONT}`
  ctx.fillText(opts.title, PAD, PAD + TITLE_H / 2 - 6)
  ctx.textAlign = 'right'
  ctx.fillStyle = COLOR.soft
  ctx.font = `600 14px ${FONT}`
  ctx.fillText(opts.stamp, width - PAD, PAD + TITLE_H / 2 - 6)

  const left = PAD
  const top = PAD + TITLE_H
  const bodyTop = top + HEAD_H
  const bottom = bodyTop + ROW_H * opts.rows.length

  // 머리줄
  ctx.fillStyle = COLOR.head
  ctx.fillRect(left, top, tableW, HEAD_H)
  ctx.textAlign = 'center'
  ctx.fillStyle = COLOR.ink
  ctx.font = `800 17px ${FONT}`
  ctx.fillText('일자', left + DATE_W / 2, top + HEAD_H / 2)
  opts.posts.forEach((p, i) => ctx.fillText(p, left + DATE_W + colW * i + colW / 2, top + HEAD_H / 2))

  // 본문
  opts.rows.forEach((row, r) => {
    const y = bodyTop + ROW_H * r
    const cy = y + ROW_H / 2

    ctx.fillStyle = COLOR.dateBg
    ctx.fillRect(left, y, DATE_W, ROW_H)
    ctx.fillStyle = row.weekday === 0 ? COLOR.sun : row.weekday === 6 ? COLOR.sat : COLOR.ink
    ctx.font = `800 16px ${FONT}`
    ctx.fillText(row.label, left + DATE_W / 2, cy)

    row.cells.forEach((cell, i) => {
      if (!cell) return
      const x = left + DATE_W + colW * i
      if (cell.closed) {
        ctx.fillStyle = COLOR.closedBg
        ctx.fillRect(x, y, colW, ROW_H)
      }
      ctx.fillStyle = cell.closed ? COLOR.soft : cell.changed ? COLOR.ok : COLOR.ink
      ctx.font = `${cell.closed ? 600 : cell.changed ? 800 : 700} 16px ${FONT}`
      ctx.fillText(cell.text, x + colW / 2, cy)

      if (cell.later) {
        const w = ctx.measureText(cell.text).width
        ctx.fillStyle = COLOR.warn
        ctx.fillRect(x + colW / 2 - w / 2, cy + 11, w, 2)
      }
    })
  })

  // 칸 선
  ctx.fillStyle = COLOR.line
  for (let r = 1; r < opts.rows.length; r++) ctx.fillRect(left, bodyTop + ROW_H * r, tableW, 1)
  for (let i = 1; i < opts.posts.length; i++) ctx.fillRect(left + DATE_W + colW * i, top, 1, bottom - top)
  ctx.fillStyle = COLOR.strong
  ctx.fillRect(left, bodyTop - 1, tableW, 2)
  ctx.fillRect(left + DATE_W - 1, top, 2, bottom - top)
  ctx.strokeStyle = COLOR.strong
  ctx.lineWidth = 2
  ctx.strokeRect(left, top, tableW, bottom - top)

  // 범례
  ctx.textAlign = 'left'
  ctx.fillStyle = COLOR.soft
  ctx.font = `600 14px ${FONT}`
  ctx.fillText(opts.legend, left, bottom + FOOT_H / 2 + 2)

  // toBlob 은 비동기라 휴대폰의 "공유하기" 허용 시간이 지나버릴 수 있어 곧바로 만든다
  const base64 = canvas.toDataURL('image/png').split(',')[1]
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: 'image/png' })
}

/**
 * 그림 저장.
 * 휴대폰은 공유 창을 띄워 [이미지 저장]·카카오톡 보내기를 고를 수 있게 하고,
 * 컴퓨터는 파일로 내려받는다.
 */
export async function saveImage(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: 'image/png' })
  const touch = window.matchMedia('(pointer: coarse)').matches
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return // 사용자가 닫음
      // 공유가 막힌 기기는 아래의 내려받기로
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
