"use client";

/**
 * The registration form builder.
 *
 * Adam asked to "drag questions around the form", so the handle is a real
 * HTML5 drag — and every row also carries 44px up/down buttons, because a drag
 * is not reachable from a keyboard and is miserable on a phone. The order is
 * held locally while it is being shuffled and written in ONE call
 * (`set_registration_question_order` renumbers 1..n), which is the same shape
 * as the waiting list's priorities panel and for the same reason: a
 * half-applied reorder is worse than none.
 *
 * The padlock rules are the database's. A built-in question keeps its key and
 * its type and cannot be retired; photo permissions, GDPR and the club's terms
 * cannot be retired OR made optional. The controls for those are simply not
 * rendered — the trigger would refuse anyway, and offering a button that
 * always fails is not a kindness.
 */

import { useActionState, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, GripVertical, Lock, Plus, RotateCcw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  CUSTOM_QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  type RegistrationQuestion,
} from "@/lib/registration-questions";

import {
  addQuestion,
  saveQuestionOrder,
  setQuestionArchived,
  updateQuestion,
  type BuilderState,
} from "./actions";

const EMPTY: BuilderState = {};

function Message({ state }: { state: BuilderState }) {
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (state.notice) return <p className="text-sm text-emerald-700">{state.notice}</p>;
  return null;
}

// ---------------------------------------------------------------------------

function QuestionRow({
  question,
  index,
  count,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
  dragging,
}: {
  question: RegistrationQuestion;
  index: number;
  count: number;
  onMove: (index: number, delta: number) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDrop: () => void;
  dragging: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editState, editAction, editPending] = useActionState(updateQuestion, EMPTY);
  const [archiveState, archiveAction, archivePending] = useActionState(setQuestionArchived, EMPTY);

  const canArchive = !question.system && !question.locked;
  const canBeOptional = !question.locked;
  const hasOptions = question.qtype === "select" || question.qtype === "kit_size";

  return (
    <li
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver(index);
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      onDragEnd={onDrop}
      className={
        "rounded-lg border bg-card " + (dragging ? "border-primary opacity-60" : "border-border")
      }
    >
      <div className="flex flex-wrap items-center gap-2 p-3">
        <span
          aria-hidden="true"
          className="hidden cursor-grab text-muted-foreground lg:inline-flex"
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </span>
        <span className="w-6 flex-none text-xs text-muted-foreground">{index + 1}</span>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="min-h-[44px] flex-1 text-left text-sm font-medium lg:min-h-0"
        >
          {question.label}
          {question.archivedAt && (
            <Badge variant="muted" className="ml-2">
              Retired
            </Badge>
          )}
        </button>

        <Badge variant="outline">{QUESTION_TYPE_LABELS[question.qtype]}</Badge>
        {question.required && <Badge variant="warning">Required</Badge>}
        {question.locked ? (
          <Badge variant="default" title="Photo permissions, GDPR and the club's terms are on every form">
            <Lock className="mr-1 h-3 w-3" /> Always on
          </Badge>
        ) : question.system ? (
          <Badge variant="muted" title="Built in — its key and type are fixed">
            <Lock className="mr-1 h-3 w-3" /> Built in
          </Badge>
        ) : null}

        <span className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onMove(index, -1)}
            disabled={index === 0}
            aria-label={`Move ${question.label} up`}
            className="min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onMove(index, 1)}
            disabled={index === count - 1}
            aria-label={`Move ${question.label} down`}
            className="min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
        </span>
      </div>

      {open && (
        <div className="space-y-3 border-t p-3">
          <form action={editAction} className="space-y-3">
            <input type="hidden" name="question_id" value={question.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`label-${question.id}`}>Question</Label>
                <Input id={`label-${question.id}`} name="label" defaultValue={question.label} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`help-${question.id}`}>Help text</Label>
                <Input
                  id={`help-${question.id}`}
                  name="help_text"
                  defaultValue={question.helpText ?? ""}
                  placeholder="Optional — shown under the question"
                />
              </div>
            </div>

            {hasOptions && (
              <div className="space-y-1">
                <Label htmlFor={`options-${question.id}`}>Options, one per line</Label>
                <textarea
                  id={`options-${question.id}`}
                  name="options"
                  rows={Math.max(3, question.options.length)}
                  defaultValue={question.options.join("\n")}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="required"
                value="yes"
                defaultChecked={question.required}
                disabled={!canBeOptional}
                className="h-4 w-4"
              />
              Required
              {!canBeOptional && (
                <span className="text-xs text-muted-foreground">
                  — photo permissions, data protection and the club&rsquo;s terms are asked on every
                  registration and cannot be made optional.
                </span>
              )}
            </label>
            {!canBeOptional && <input type="hidden" name="required" value="yes" />}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={editPending}>
                {editPending ? "Saving…" : "Save question"}
              </Button>
              <Message state={editState} />
            </div>
          </form>

          <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
            <code>{question.qkey}</code>
            {question.system && (
              <span>
                Built in: the wording and the order are yours, the key and the sort of answer are
                fixed because a screen renders this one by name.
              </span>
            )}
            {canArchive && !question.archivedAt && (
              <form action={archiveAction} className="ml-auto">
                <input type="hidden" name="question_id" value={question.id} />
                <input type="hidden" name="archived" value="yes" />
                <Button
                  type="submit"
                  size="sm"
                  variant="ghost"
                  disabled={archivePending}
                  className="min-h-[44px] text-destructive lg:min-h-0"
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Retire
                </Button>
              </form>
            )}
            {question.archivedAt && (
              <form action={archiveAction} className="ml-auto">
                <input type="hidden" name="question_id" value={question.id} />
                <input type="hidden" name="archived" value="no" />
                <Button type="submit" size="sm" variant="ghost" disabled={archivePending} className="min-h-[44px] lg:min-h-0">
                  <RotateCcw className="mr-1 h-3.5 w-3.5" /> Put back on the form
                </Button>
              </form>
            )}
            <Message state={archiveState} />
          </div>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------

function AddQuestion() {
  const [state, action, pending] = useActionState(addQuestion, EMPTY);
  const [qtype, setQtype] = useState<string>("short_text");

  return (
    <form action={action} className="space-y-3 rounded-lg border border-dashed p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Plus className="h-4 w-4" /> Add a question
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="new-label">Question</Label>
          <Input id="new-label" name="label" placeholder="e.g. School year" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-type">Sort of answer</Label>
          <select
            id="new-type"
            name="qtype"
            value={qtype}
            onChange={(event) => setQtype(event.target.value)}
            className="block h-11 w-full rounded-md border bg-background px-3 text-sm lg:h-10"
          >
            {CUSTOM_QUESTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {QUESTION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="new-help">Help text</Label>
        <Input id="new-help" name="help_text" placeholder="Optional" />
      </div>
      {qtype === "select" && (
        <div className="space-y-1">
          <Label htmlFor="new-options">Options, one per line</Label>
          <textarea
            id="new-options"
            name="options"
            rows={4}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="required" value="yes" className="h-4 w-4" />
        Required
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending} className="min-h-[44px] lg:min-h-0">
          {pending ? "Adding…" : "Add question"}
        </Button>
        <Message state={state} />
      </div>
      <p className="text-xs text-muted-foreground">
        A new question goes on the end of the form; drag it where you want it and save the order.
        Answers are stored against the question&rsquo;s key, so retiring a question later never
        loses the answers already given.
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------

export function FormBuilder({ questions }: { questions: RegistrationQuestion[] }) {
  const live = questions.filter((question) => !question.archivedAt);
  const retired = questions.filter((question) => question.archivedAt);

  const [order, setOrder] = useState<RegistrationQuestion[]>(live);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [orderState, setOrderState] = useState<BuilderState>(EMPTY);
  const [orderPending, startOrderSave] = useTransition();

  const dirty = order.some((question, index) => live[index]?.id !== question.id);

  // Not a <form>: every row carries its own edit and retire forms, and a form
  // inside a form is not a thing HTML has. The whole list goes in one call.
  function saveOrder() {
    const formData = new FormData();
    for (const question of order) formData.append("question_id", question.id);
    startOrderSave(async () => {
      setOrderState(await saveQuestionOrder(EMPTY, formData));
    });
  }

  function move(index: number, delta: number) {
    setOrder((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = current.slice();
      const moved = next[index];
      const displaced = next[target];
      if (!moved || !displaced) return current;
      next[index] = displaced;
      next[target] = moved;
      return next;
    });
  }

  function dragOver(index: number) {
    setDragIndex((from) => {
      if (from === null || from === index) return from;
      setOrder((current) => {
        const next = current.slice();
        const [moved] = next.splice(from, 1);
        if (!moved) return current;
        next.splice(index, 0, moved);
        return next;
      });
      return index;
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <ul className="space-y-2">
          {order.map((question, index) => (
            <QuestionRow
              key={question.id}
              question={question}
              index={index}
              count={order.length}
              onMove={move}
              onDragStart={setDragIndex}
              onDragOver={dragOver}
              onDrop={() => setDragIndex(null)}
              dragging={dragIndex === index}
            />
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={saveOrder}
            disabled={orderPending || !dirty}
            className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
          >
            {orderPending ? "Saving…" : dirty ? "Save order" : "Order saved"}
          </Button>
          <Message state={orderState} />
        </div>
      </div>

      <AddQuestion />

      {retired.length > 0 && (
        <details className="rounded-lg border bg-card">
          <summary className="min-h-[44px] cursor-pointer px-4 py-3 text-sm font-medium">
            Retired questions ({retired.length})
          </summary>
          <ul className="space-y-2 border-t p-3">
            {retired.map((question, index) => (
              <QuestionRow
                key={question.id}
                question={question}
                index={index}
                count={retired.length}
                onMove={() => undefined}
                onDragStart={() => undefined}
                onDragOver={() => undefined}
                onDrop={() => undefined}
                dragging={false}
              />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
