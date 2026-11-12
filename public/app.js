
function renderRoutineActivities() {
  const box = $("routineActivities");
  if (!box) return;

  box.replaceChildren();

  const total = routineItems.length;
  const completed = routineItems.filter(item =>
    routineLogs[item.id]?.status === "completed"
  ).length;

  const percentage = total
    ? Math.round((completed / total) * 100)
    : 0;

  if ($("routineProgressText")) {
    $("routineProgressText").textContent =
      `${completed} of ${total} activities completed today · ${percentage}%`;
  }

  if ($("routineProgressBar")) {
    $("routineProgressBar").style.width = `${percentage}%`;
  }

  if (!selectedRoutineId) {
    const empty = document.createElement("p");
    empty.className = "routine-empty";
    empty.textContent = "Select a plan or create a new one to get started.";
    box.appendChild(empty);
    return;
  }

  const selected = routines.find(r => r.id === selectedRoutineId);

  // Plan overview
  const overview = document.createElement("section");
  overview.className = "plan-overview-card";

  const overviewLabel = document.createElement("span");
  overviewLabel.className = "routine-small-label";
  overviewLabel.textContent = "PLAN OVERVIEW";

  const overviewDescription = document.createElement("p");
  overviewDescription.textContent =
    selected?.description || "Your personalized plan.";

  const overviewProgress = document.createElement("div");
  overviewProgress.className = "plan-overview-progress";

  const progressText = document.createElement("strong");
  progressText.textContent = `${percentage}% complete`;

  overviewProgress.append(progressText);
  overview.append(overviewLabel, overviewDescription, overviewProgress);
  box.appendChild(overview);

  if (!total) {
    const empty = document.createElement("p");
    empty.className = "routine-empty";
    empty.textContent = "Your plan is ready for activities. Add your first activity.";
    box.appendChild(empty);
    return;
  }

  // Group activities into weeks, days, phases or sessions.
  function getGroup(item) {
    const text = `${item.title} ${item.description}`.toLowerCase();

    const patterns = [
      { regex: /\bweek\s*(\d+)\b/i, label: match => `Week ${match[1]}` },
      { regex: /\bday\s*(\d+)\b/i, label: match => `Day ${match[1]}` },
      { regex: /\bphase\s*(\d+)\b/i, label: match => `Phase ${match[1]}` },
      { regex: /\b(session|lesson)\s*(\d+)\b/i, label: match => `${match[1]} ${match[2]}` }
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern.regex);
      if (match) return pattern.label(match);
    }

    return "Your activities";
  }

  const groups = new Map();

  routineItems.forEach(item => {
    const group = getGroup(item);

    if (!groups.has(group)) {
      groups.set(group, []);
    }

    groups.get(group).push(item);
  });

  // Render each organized section.
  groups.forEach((items, groupName) => {
    const section = document.createElement("section");
    section.className = "plan-section";

    const heading = document.createElement("div");
    heading.className = "plan-section-heading";

    const title = document.createElement("h3");
    title.textContent = groupName;

    const count = document.createElement("span");
    count.textContent = `${items.length} ${items.length === 1 ? "activity" : "activities"}`;

    heading.append(title, count);
    section.appendChild(heading);

    items.forEach(item => {
      const originalIndex = routineItems.findIndex(
        entry => entry.id === item.id
      );

      const card = document.createElement("article");
      card.className = "routine-activity";

      const details = document.createElement("div");
      details.className = "routine-activity-details";

      const heading = document.createElement("strong");
      heading.textContent = item.title;

      const time = document.createElement("span");
      time.textContent = item.scheduled_time
        ? item.scheduled_time.slice(0, 5)
        : "Flexible time";

      const description = document.createElement("p");
      description.textContent = item.description || "Follow this activity as part of your plan.";

      const log = routineLogs[item.id];

      const status = document.createElement("span");
      status.className = "routine-activity-status";
      status.textContent = log?.status
        ? log.status.charAt(0).toUpperCase() + log.status.slice(1)
        : "Pending";

      if (log?.status) {
        status.dataset.status = log.status;
      }

      details.append(heading, time, description, status);

      const actions = document.createElement("div");
      actions.className = "routine-activity-actions";

      actions.append(
        makeRoutineButton("Complete", () => updateRoutineStatus(item, "completed")),
        makeRoutineButton("Skip", () => updateRoutineStatus(item, "skipped")),
        makeRoutineButton("Postpone", () => postponeRoutineItem(item))
      );

      actions.append(
        makeRoutineButton("Edit", () => editRoutineItem(item)),
        makeRoutineButton("Move up", () => moveRoutineItem(originalIndex, -1), originalIndex === 0),
        makeRoutineButton("Move down", () => moveRoutineItem(originalIndex, 1), originalIndex === total - 1),
        makeRoutineButton("Delete", () => deleteRoutineItem(item))
      );

      card.append(details, actions);
      section.appendChild(card);
    });

    box.appendChild(section);
  });
}
