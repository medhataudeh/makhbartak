"use client";
import { useMemo, useState } from "react";
import { Plus, StickyNote } from "lucide-react";
import type { Order, OrderNote } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { addNote } from "@/lib/store";
import type { ControlCenterRole } from "@/components/admin/OrderControlCenter";
import { Card } from "@/components/admin/occ-helpers";

export function NotesTab({ order, role }: { order: Order; role: ControlCenterRole }) {
  const [text, setText] = useState("");
  const sortedNotes = useMemo(() => {
    const notes = order.notes ?? [];
    return [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [order.notes]);

  const submit = () => {
    if (!text.trim()) return;
    addNote(order.id, {
      authorId: "—",
      authorName: role.actorName,
      authorRole: role.role === "lab_user" ? "lab" : "admin",
      text: text.trim(),
    });
    setText("");
  };

  return (
    <div className="space-y-3">
      <Card title="إضافة ملاحظة داخلية" icon={<StickyNote size={14} aria-hidden="true" />}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="ملاحظة لا يراها العميل…"
          className="w-full p-2.5 rounded-lg border border-gray-200 text-xs resize-none focus:border-[#0891B2] outline-none"
        />
        <Button size="sm" variant="primary" className="mt-2" disabled={!text.trim()} onClick={submit}>
          <Plus size={13} aria-hidden="true" />
          إضافة
        </Button>
      </Card>

      {sortedNotes.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">لا توجد ملاحظات</p>
      ) : (
        <ul className="space-y-2">
          {sortedNotes.map((n: OrderNote) => (
            <li key={n.id} className="bg-white rounded-xl border border-gray-100 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-bold text-[#164E63]">{n.authorName} · {n.authorRole}</p>
                <span className="text-[11px] text-gray-400">{relativeTime(n.createdAt)}</span>
              </div>
              <p className="text-xs text-[#164E63] mt-1 leading-relaxed">{n.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
