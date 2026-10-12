export function renderVetoSteps(container, { steps, history, currentStep, phase, tagA, tagB, decider, mapName }) {
    const doc = container.ownerDocument;
    const span = (className, text) => { const node = doc.createElement('span'); node.className = className; node.textContent = String(text); return node; };
    const nodes = steps.map((step, index) => {
        const row = doc.createElement('div');
        row.className = `veto-step team-${step.team.toLowerCase()} ${index === currentStep && phase === 'veto' ? 'active' : ''} ${index < currentStep ? 'done' : ''}`;
        row.setAttribute('role', 'listitem');
        row.append(span('step-team', step.team === 'A' ? tagA : tagB), span(`step-action ${step.action}`, step.action === 'ban' ? 'Ban' : 'Pick'));
        if (history[index])
            row.append(history[index].voided ? span('step-void', 'VOID') : span('step-map', mapName(history[index].map)));
        return row;
    });
    const wheel = doc.createElement('div');
    wheel.className = `veto-step ${phase === 'wheel' ? 'active' : ''} ${phase === 'result' ? 'done' : ''}`;
    wheel.setAttribute('role', 'listitem');
    const star = span('step-team', '★');
    star.style.color = '#facc15';
    wheel.append(star, span('step-action', 'Wheel'));
    if (decider)
        wheel.append(span('step-map', mapName(decider)));
    container.replaceChildren(...nodes, wheel);
}
