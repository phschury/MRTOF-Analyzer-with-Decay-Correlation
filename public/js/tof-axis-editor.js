(function(root) {
    const bindings = new WeakMap();
    function attach(plot, navigate) {
        if (!bindings.has(plot)) {
            const binding = {navigate};
            bindings.set(plot, binding);
            plot.on('plotly_afterplot', () => decorate(plot, binding));
        }
        const binding = bindings.get(plot);
        binding.navigate = navigate;
        decorate(plot, binding);
    }
    function decorate(plot, binding) {
        const title = plot.querySelector('.xtitle');
        if (!title || title.querySelector('[data-tof-reference]')) return;
        const match = title.textContent.match(/^ToF - (.+) \[(ns|µs)\]$/);
        if (!match) return;
        const reference = Number(match[1].replace(/[,\s]/g, ''));
        if (!Number.isFinite(reference)) return;
        const span = text => {
            const node = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            node.textContent = text;
            return node;
        };
        const number = span(match[1]);
        number.setAttribute('data-tof-reference', '');
        number.setAttribute('role', 'button');
        number.setAttribute('tabindex', '0');
        number.setAttribute('aria-label', `Change viewed ToF reference in ${match[2]}`);
        number.style.cssText = 'cursor:pointer;pointer-events:all;text-decoration:underline';
        title.replaceChildren(span('ToF - '), number, span(` [${match[2]}]`));
        const edit = event => {
            event.preventDefault();
            event.stopPropagation();
            if (binding.input) return;
            const rect = number.getBoundingClientRect();
            const input = document.createElement('input');
            binding.input = input;
            input.type = 'text';
            input.inputMode = 'decimal';
            input.value = String(reference);
            input.setAttribute('aria-label', `ToF reference [${match[2]}]`);
            input.title = 'Enter to move the view; Escape to cancel';
            Object.assign(input.style, {position:'fixed', left:`${rect.left}px`, top:`${rect.top-4}px`,
                width:`${Math.max(110,rect.width+20)}px`, zIndex:'10000', boxSizing:'border-box',
                font:'14px sans-serif', padding:'3px 5px'});
            let closed = false;
            const close = commit => {
                if (closed) return;
                const text = input.value.replace(/[,\s]/g, '');
                const value = text === '' ? NaN : Number(text);
                if (commit && (!Number.isFinite(value) || value < 0)) {
                    input.setCustomValidity('Enter a finite, non-negative time.');
                    input.reportValidity();
                    input.focus();
                    return;
                }
                closed = true;
                binding.input = null;
                input.remove();
                if (commit && value !== reference) binding.navigate(value, match[2], reference);
            };
            input.addEventListener('input', () => input.setCustomValidity(''));
            input.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    close(event.key === 'Enter');
                }
            });
            input.addEventListener('blur', () => close(true));
            document.body.append(input);
            input.focus();
            input.select();
        };
        number.addEventListener('click', edit);
        number.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') edit(event);
        });
    }
    root.TofAxisEditor = {attach};
})(globalThis);
