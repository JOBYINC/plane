# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db.models import Exists, OuterRef

# Third Party imports
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny

# Module imports
from .base import BaseAPIView
from plane.app.serializers import DeployBoardSerializer
from plane.db.models import Project, DeployBoard, ProjectMember, ProjectSection, IssueRelation


class ProjectDeployBoardPublicSettingsEndpoint(BaseAPIView):
    permission_classes = [AllowAny]

    def get(self, request, anchor):
        project_deploy_board = DeployBoard.objects.get(anchor=anchor, entity_name="project")
        serializer = DeployBoardSerializer(project_deploy_board)
        return Response(serializer.data, status=status.HTTP_200_OK)


class WorkspaceProjectDeployBoardEndpoint(BaseAPIView):
    permission_classes = [AllowAny]

    def get(self, request, anchor):
        deploy_board = DeployBoard.objects.filter(anchor=anchor, entity_name="project").values_list
        projects = (
            Project.objects.filter(workspace=deploy_board.workspace)
            .annotate(
                is_public=Exists(
                    DeployBoard.objects.filter(anchor=anchor, project_id=OuterRef("pk"), entity_name="project")
                )
            )
            .filter(is_public=True)
        ).values(
            "id",
            "identifier",
            "name",
            "description",
            "emoji",
            "icon_prop",
            "cover_image",
        )

        return Response(projects, status=status.HTTP_200_OK)


class WorkspaceProjectAnchorEndpoint(BaseAPIView):
    permission_classes = [AllowAny]

    def get(self, request, slug, project_id):
        project_deploy_board = DeployBoard.objects.get(
            workspace__slug=slug, project_id=project_id, entity_name="project"
        )
        serializer = DeployBoardSerializer(project_deploy_board)
        return Response(serializer.data, status=status.HTTP_200_OK)


class ProjectMembersEndpoint(BaseAPIView):
    permission_classes = [AllowAny]

    def get(self, request, anchor):
        deploy_board = DeployBoard.objects.filter(anchor=anchor).first()
        if not deploy_board:
            return Response(
                {"error": "Invalid anchor"},
                status=status.HTTP_404_NOT_FOUND,
            )

        members = ProjectMember.objects.filter(
            project=deploy_board.project,
            workspace=deploy_board.workspace,
            is_active=True,
        ).values(
            "id",
            "member",
            "member__display_name",
            "member__avatar",
        )
        return Response(members, status=status.HTTP_200_OK)


class ProjectSectionsPublicEndpoint(BaseAPIView):
    """Read-only list of a published project's active sections (for the public
    Timeline swimlanes). Anchor-gated exactly like the other public endpoints."""

    permission_classes = [AllowAny]

    def get(self, request, anchor):
        deploy_board = DeployBoard.objects.filter(anchor=anchor, entity_name="project").first()
        if not deploy_board:
            return Response({"error": "Project is not published"}, status=status.HTTP_404_NOT_FOUND)

        sections = ProjectSection.objects.filter(
            project_id=deploy_board.entity_identifier,
            is_archived=False,
        ).values("id", "name", "sort_order", "is_collapsed_default")
        return Response(list(sections), status=status.HTTP_200_OK)


class ProjectIssueRelationsPublicEndpoint(BaseAPIView):
    """Read-only dependency relations for a published project's issues, shaped to
    match the app's `issue_relation`/`issue_related` expand so the public Timeline
    can reuse `extractRelationsFromIssues`. Anchor-gated."""

    permission_classes = [AllowAny]

    def get(self, request, anchor):
        deploy_board = DeployBoard.objects.filter(anchor=anchor, entity_name="project").first()
        if not deploy_board:
            return Response({"error": "Project is not published"}, status=status.HTTP_404_NOT_FOUND)

        project_id = deploy_board.entity_identifier
        relations = IssueRelation.objects.filter(project_id=project_id).values(
            "issue_id", "related_issue_id", "relation_type"
        )

        # Build per-issue { id, issue_relation: [{id, relation_type}], issue_related: [...] }
        by_issue = {}

        def _entry(issue_id):
            key = str(issue_id)
            if key not in by_issue:
                by_issue[key] = {"id": key, "issue_relation": [], "issue_related": []}
            return by_issue[key]

        for relation in relations:
            issue_id = relation["issue_id"]
            related_issue_id = relation["related_issue_id"]
            relation_type = relation["relation_type"]
            # forward: the issue's own relations point at the related issue
            _entry(issue_id)["issue_relation"].append(
                {"id": str(related_issue_id), "relation_type": relation_type}
            )
            # reverse: the related issue sees this issue as a "related" entry
            _entry(related_issue_id)["issue_related"].append(
                {"id": str(issue_id), "relation_type": relation_type}
            )

        return Response(list(by_issue.values()), status=status.HTTP_200_OK)
