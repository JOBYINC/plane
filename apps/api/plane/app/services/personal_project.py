# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from plane.app.permissions import ROLE
from plane.db.models import (
    DEFAULT_STATES,
    Project,
    ProjectIdentifier,
    ProjectMember,
    ProjectNetwork,
    State,
)


def get_or_create_personal_project(workspace, owner, actor=None):
    """Return ``owner``'s personal ("My Tasks") project in ``workspace``,
    lazily creating it on first use.

    ``owner`` becomes ``personal_owner`` and the sole ADMIN
    ``ProjectMember``. ``actor`` is the user triggering the call and is
    recorded as ``created_by`` on the ``Project`` and on the seeded
    ``DEFAULT_STATES`` rows; it defaults to ``owner`` for the
    session-API self-create case. Token-API callers acting on behalf of
    others should pass both: ``owner`` = target member,
    ``actor`` = the system-token's user.

    Bootstrap is identical to the prior in-view implementation:

    - identifier ``MT{SHORT}`` and name ``My Tasks {SHORT}`` where
      ``SHORT`` is the upper-cased first 8 hex of ``owner.id``;
      numeric ``{suffix}`` appended on per-workspace collision against
      ``(identifier, workspace)`` or ``(name, workspace)``
    - ``network = ProjectNetwork.SECRET`` (not workspace-discoverable)
    - ``is_personal = True``
    - matching ``ProjectIdentifier`` row
    - ``ProjectMember`` for ``owner`` with role ADMIN
    - ``State`` rows bulk-created from ``DEFAULT_STATES``
    """
    if actor is None:
        actor = owner

    project = Project.objects.filter(
        workspace=workspace,
        is_personal=True,
        personal_owner=owner,
        deleted_at__isnull=True,
    ).first()
    if project is not None:
        return project

    short = str(owner.id).replace("-", "")[:8].upper()
    identifier = f"MT{short}"[:12]
    name = f"My Tasks {short}"
    # defensive: stay within the per-workspace unique constraints
    # on (identifier, workspace) and (name, workspace)
    suffix = 1
    while (
        Project.objects.filter(
            workspace=workspace,
            identifier=identifier,
            deleted_at__isnull=True,
        ).exists()
        or Project.objects.filter(
            workspace=workspace, name=name, deleted_at__isnull=True
        ).exists()
    ):
        identifier = f"MT{short}{suffix}"[:12]
        name = f"My Tasks {short} {suffix}"
        suffix += 1

    # Construct + explicit save(created_by_id=) so the helper honors the
    # passed ``actor`` regardless of request context. BaseModel.save()
    # otherwise overwrites ``created_by`` from crum's current user, which
    # would silently work for session-API callers (request.user is in crum
    # context) but break out-of-band callers like celery tasks.
    project = Project(
        name=name,
        identifier=identifier,
        workspace=workspace,
        network=ProjectNetwork.SECRET.value,
        is_personal=True,
        personal_owner=owner,
    )
    project.save(created_by_id=actor.id)
    ProjectIdentifier.objects.create(
        name=project.identifier,
        project=project,
        workspace_id=workspace.id,
    )
    ProjectMember.objects.create(
        project=project,
        member=owner,
        role=ROLE.ADMIN.value,
    )
    State.objects.bulk_create(
        [
            State(
                name=state["name"],
                color=state["color"],
                project=project,
                sequence=state["sequence"],
                workspace=workspace,
                group=state["group"],
                default=state.get("default", False),
                created_by=actor,
            )
            for state in DEFAULT_STATES
        ]
    )
    return project
