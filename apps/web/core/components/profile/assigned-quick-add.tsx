/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Plus, X } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EIssuesStoreType, type TIssue } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { DateDropdown } from "@/components/dropdowns/date";
import { ProjectDropdown } from "@/components/dropdowns/project/dropdown";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useUser } from "@/hooks/store/user";
import { useIssuesActions } from "@/hooks/use-issues-actions";
import useLocalStorage from "@/hooks/use-local-storage";

const QUICK_ADD_PROJECT_KEY = "profileAssignedQuickAddProjectId";

export const ProfileAssignedQuickAdd = observer(function ProfileAssignedQuickAdd() {
  const { t } = useTranslation();
  // refs
  const inputRef = useRef<HTMLInputElement | null>(null);
  // router
  const { userId: routeUserId } = useParams();
  // store hooks
  const { data: currentUser } = useUser();
  const { joinedProjectIds } = useProject();
  const { createIssue } = useIssuesActions(EIssuesStoreType.PROFILE);
  // Only show quick-add on the viewer's own Assigned page — creating a task
  // here always assigns it to `currentUser.id`, so on someone else's profile
  // the button would silently mis-route work to the viewer instead of the
  // profile owner. Hiding it is clearer than guessing intent.
  const isOwnProfile = !!currentUser?.id && routeUserId?.toString() === currentUser.id;
  // last-used project persists across sessions for rapid re-entry.
  const { storedValue: persistedProjectId, setValue: setPersistedProjectId } = useLocalStorage<string | null>(
    QUICK_ADD_PROJECT_KEY,
    null
  );
  // local state
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Resolve a sensible default project: last-used (if still joined) → first joined.
  useEffect(() => {
    if (projectId) return;
    if (joinedProjectIds.length === 0) return;
    const initial =
      persistedProjectId && joinedProjectIds.includes(persistedProjectId) ? persistedProjectId : joinedProjectIds[0];
    setProjectId(initial);
  }, [joinedProjectIds, persistedProjectId, projectId]);

  // Autofocus title input when the composer opens.
  useEffect(() => {
    if (isComposerOpen) inputRef.current?.focus();
  }, [isComposerOpen]);

  const closeComposer = () => {
    setIsComposerOpen(false);
    setTitle("");
    setDueDate(null);
  };

  // The composer is dismissed only on Escape, the cancel button, or after a
  // successful submit — an outside-click handler would misfire on the
  // project dropdown popper (rendered via a portal outside `composerRef`).

  const handleProjectChange = (next: string) => {
    setProjectId(next);
    setPersistedProjectId(next);
  };

  const handleSubmit = async () => {
    const name = title.trim();
    if (!name || !projectId || !currentUser?.id || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const payload: Partial<TIssue> = {
        name,
        assignee_ids: [currentUser.id],
      };
      if (dueDate) {
        // Server expects a YYYY-MM-DD calendar date in the workspace's TZ-naive
        // due-date column; we send the user's local date components so the
        // picked day doesn't drift across UTC boundaries.
        const year = dueDate.getFullYear();
        const month = String(dueDate.getMonth() + 1).padStart(2, "0");
        const day = String(dueDate.getDate()).padStart(2, "0");
        payload.target_date = `${year}-${month}-${day}`;
      }
      await createIssue?.(projectId, payload);
      // Clear input but keep the composer open so the user can add another, Asana-style.
      setTitle("");
      setDueDate(null);
      inputRef.current?.focus();
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("common.error.label"),
        message: t("common.error.message"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeComposer();
    }
  };

  const canCreate = joinedProjectIds.length > 0;

  if (!isOwnProfile) return null;

  if (!isComposerOpen) {
    return (
      <div className="flex w-full px-4 pt-3">
        <Button
          variant="primary"
          size="sm"
          prependIcon={<Plus className="size-4" />}
          onClick={() => setIsComposerOpen(true)}
          disabled={!canCreate}
        >
          {t("common.add_task")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full px-4 pt-3">
      <div
        className={cn("flex w-full max-w-2xl items-center gap-2 rounded-md border border-strong bg-surface-1 p-2", {
          "opacity-70": isSubmitting,
        })}
      >
        <ProjectDropdown
          buttonVariant="border-with-text"
          multiple={false}
          value={projectId}
          onChange={handleProjectChange}
        />
        <input
          ref={inputRef}
          type="text"
          value={title}
          placeholder={t("common.task_name_placeholder")}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSubmitting}
          className="h-8 flex-1 bg-transparent px-2 text-13 outline-none placeholder:text-tertiary"
        />
        <DateDropdown
          buttonVariant={dueDate ? "border-with-text" : "border-without-text"}
          buttonContainerClassName="rounded"
          value={dueDate}
          onChange={setDueDate}
          placeholder={t("common.due_date")}
          isClearable
          disabled={isSubmitting}
        />
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          loading={isSubmitting}
          disabled={!title.trim() || !projectId || isSubmitting}
        >
          {t("common.add")}
        </Button>
        <button
          type="button"
          onClick={closeComposer}
          className="grid size-7 place-items-center rounded text-tertiary hover:bg-surface-2 hover:text-primary"
          aria-label={t("common.cancel")}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
});
