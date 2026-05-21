/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Copy, FileText } from "lucide-react";
import { Disclosure, Transition } from "@headlessui/react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { ChevronRightIcon } from "@plane/propel/icons";
import { IconButton } from "@plane/propel/icon-button";
import { Tooltip } from "@plane/propel/tooltip";
import { Loader } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useProject } from "@/hooks/store/use-project";
// local
import { UseTemplateModal } from "./use-template-modal";

const STORAGE_KEY = "isTemplatesListOpen";

/**
 * Sidebar section listing workspace-canonical template projects
 * (``is_template=true``). Disjoint from the main Projects list. Each
 * row exposes a hover-revealed "create launch from template" button
 * that drives ``POST /projects/<id>/duplicate/``.
 */
export const SidebarTemplatesList = observer(function SidebarTemplatesList() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams();
  const { templateProjectIds, getPartialProjectById, fetchTemplateProjects } = useProject();

  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === "true";
  });
  const [isLoading, setIsLoading] = useState(false);
  const [modalSourceId, setModalSourceId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceSlug) return;
    setIsLoading(true);
    fetchTemplateProjects(workspaceSlug.toString())
      .catch(() => {
        // Failure is non-fatal — the section just stays empty. The main
        // Projects list still loads via its own fetch path.
      })
      .finally(() => setIsLoading(false));
  }, [workspaceSlug, fetchTemplateProjects]);

  const toggle = (next: boolean) => {
    setIsOpen(next);
    localStorage.setItem(STORAGE_KEY, next.toString());
  };

  // Empty + still loading → render the section header with a skeleton.
  // Empty + done loading → render nothing so we don't burn vertical space.
  if (!isLoading && templateProjectIds.length === 0) return null;

  return (
    <>
      <UseTemplateModal
        isOpen={modalSourceId !== null}
        sourceProjectId={modalSourceId}
        onClose={() => setModalSourceId(null)}
      />
      <Disclosure as="div" className="flex flex-col" defaultOpen={isOpen}>
        <div className="group flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-placeholder hover:bg-layer-transparent-hover">
          <Disclosure.Button
            as="button"
            type="button"
            className="flex w-full items-center gap-1 text-left text-13 font-semibold whitespace-nowrap text-placeholder"
            onClick={() => toggle(!isOpen)}
          >
            <span className="text-13 font-semibold">{t("templates", { defaultValue: "Templates" })}</span>
          </Disclosure.Button>
          <IconButton
            variant="ghost"
            size="sm"
            icon={ChevronRightIcon}
            onClick={() => toggle(!isOpen)}
            className="text-placeholder"
            iconClassName={cn("transition-transform", { "rotate-90": isOpen })}
            aria-label="Toggle templates list"
          />
        </div>
        <Transition
          show={isOpen}
          enter="transition duration-100 ease-out"
          enterFrom="transform scale-95 opacity-0"
          enterTo="transform scale-100 opacity-100"
          leave="transition duration-75 ease-out"
          leaveFrom="transform scale-100 opacity-100"
          leaveTo="transform scale-95 opacity-0"
        >
          <Disclosure.Panel as="div" className="flex flex-col gap-0.5" static>
            {isLoading && templateProjectIds.length === 0 && (
              <Loader className="w-full space-y-1.5">
                {["row-1", "row-2"].map((slot) => (
                  <Loader.Item key={slot} height="28px" />
                ))}
              </Loader>
            )}
            {templateProjectIds.map((projectId) => {
              const project = getPartialProjectById(projectId);
              if (!project) return null;
              return (
                <div
                  key={projectId}
                  className="group/template-row flex items-center gap-1.5 rounded-sm pr-1 text-13 font-medium text-secondary hover:bg-layer-transparent-hover"
                >
                  {/* Template name is a real Link so click navigates into
                      the template project (issues view) to edit. The
                      hover-revealed clone button below sits OUTSIDE the
                      Link so it doesn't navigate when clicked. */}
                  <Link
                    href={workspaceSlug ? `/${workspaceSlug}/projects/${projectId}/issues` : "#"}
                    className="flex min-w-0 flex-grow items-center gap-1.5 truncate px-2 py-1.5"
                    title={project.name}
                  >
                    <FileText className="size-3.5 flex-shrink-0 text-placeholder" />
                    <span className="flex-grow truncate">{project.name}</span>
                  </Link>
                  <Tooltip tooltipHeading={t("use_template", { defaultValue: "Use this template" })} tooltipContent="">
                    <IconButton
                      variant="ghost"
                      size="sm"
                      icon={Copy}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setModalSourceId(projectId);
                      }}
                      className="hidden text-placeholder group-hover/template-row:inline-flex"
                      aria-label="Create project from this template"
                    />
                  </Tooltip>
                </div>
              );
            })}
          </Disclosure.Panel>
        </Transition>
      </Disclosure>
    </>
  );
});
