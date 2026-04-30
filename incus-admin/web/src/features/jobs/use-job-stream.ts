import type {JobStatus, ProvisioningJobStep} from "./api";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useReducer, useRef } from "react";
import { startSSE } from "@/shared/lib/sse-client";
import { jobKeys   } from "./api";

interface State {
  steps: ProvisioningJobStep[];
  /** SSE done 收到的 job 终态（succeeded/failed/partial）；null 表示进行中 */
  terminal: JobStatus | null;
}

type Action =
  | { type: "step"; step: ProvisioningJobStep }
  | { type: "done"; status: JobStatus }
  | { type: "reset" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "step": {
      // upsert by seq —— SSE 重连重放可能重发同 seq；最后一个为准
      const idx = state.steps.findIndex((s) => s.seq === action.step.seq);
      const next = idx >= 0
        ? state.steps.map((s, i) => (i === idx ? action.step : s))
        : [...state.steps, action.step].sort((a, b) => a.seq - b.seq);
      return { ...state, steps: next };
    }
    case "done":
      return { ...state, terminal: action.status };
    case "reset":
      return { steps: [], terminal: null };
    default:
      return state;
  }
}

export interface JobStreamHookResult {
  steps: ProvisioningJobStep[];
  /** null = 进行中；非 null = 终态（succeeded / failed / partial） */
  terminal: JobStatus | null;
  /** 流连接是否还活着（仅作 UI 提示，不阻塞业务） */
  connected: boolean;
}

/** 订阅一个 job 的 SSE 步骤流。jobID = null 时不发起连接（购买未提交场景）。
 *  done 到达后自动 invalidate jobKeys，让 useJobQuery 重拉一次取最终 result。 */
export function useJobStream(jobID: number | null): JobStreamHookResult {
  const [state, dispatch] = useReducer(reducer, { steps: [], terminal: null });
  const qc = useQueryClient();
  const connectedRef = useRef(false);

  useEffect(() => {
    if (jobID == null || jobID <= 0) return;
    dispatch({ type: "reset" });
    connectedRef.current = true;

    const sub = startSSE(`/api/portal/jobs/${jobID}/stream`, {
      onMessage: (msg) => {
        if (msg.event !== "step") return;
        try {
          const step = JSON.parse(msg.data) as ProvisioningJobStep;
          dispatch({ type: "step", step });
        } catch {
          // 跳过坏帧；DB 仍是真源，下次重连会回放
        }
      },
      onDone: (msg) => {
        try {
          const payload = JSON.parse(msg.data) as { status: JobStatus };
          dispatch({ type: "done", status: payload.status });
        } catch {
          dispatch({ type: "done", status: "succeeded" });
        }
        // 完成后让 useJobQuery 重新拉一次拿 result（含密码）
        qc.invalidateQueries({ queryKey: jobKeys.detail(jobID) });
        connectedRef.current = false;
      },
      onError: () => {
        connectedRef.current = false;
        // 默认行为：返回 undefined → 自动重连
      },
    });

    return () => {
      connectedRef.current = false;
      sub.close();
    };
  }, [jobID, qc]);

  return { steps: state.steps, terminal: state.terminal, connected: connectedRef.current };
}
