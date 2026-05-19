/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { LogoSpinner } from "@/components/common/logo-spinner";
import { PageHead } from "@/components/core/page-title";
// hooks
import { useAppRouter } from "@/hooks/use-app-router";
// services
import { ProjectService } from "@/services/project";
import type { Route } from "./+types/page";

const projectService = new ProjectService();

/**
 * "My Tasks" is a thin entry point: it lazily resolves the user's private
 * personal project (created server-side on first call) and redirects to its
 * normal issues page, so project-less tasks reuse 100% of the existing
 * project issue UI + create flow without any schema change.
 */
function MyTasksPage({ params }: Route.ComponentProps) {
  const { workspaceSlug } = params;
  const router = useAppRouter();
  const { t } = useTranslation();
  const [hasError, setHasError] = useState(false);
  // resolve-once guard (the effect can run twice in dev/strict mode)
  const resolvingRef = useRef(false);

  useEffect(() => {
    const slug = workspaceSlug?.toString();
    if (!slug || resolvingRef.current) return;
    resolvingRef.current = true;
    const resolve = async () => {
      try {
        const project = await projectService.getPersonalProject(slug);
        router.replace(`/${slug}/projects/${project.id}/issues/`);
      } catch {
        resolvingRef.current = false;
        setHasError(true);
      }
    };
    void resolve();
  }, [workspaceSlug, router]);

  return (
    <>
      <PageHead title={t("my_tasks")} />
      <div className="grid h-full w-full place-items-center">
        {hasError ? (
          <p className="text-sm text-secondary">Couldn&apos;t open My Tasks. Please try again.</p>
        ) : (
          <LogoSpinner />
        )}
      </div>
    </>
  );
}

export default observer(MyTasksPage);
