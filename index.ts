// ==UserScript==
// @author Brian Frichette
// @name WaniKani Keyboard Focus
// @description Keeps keyboard focus on the lesson input field
// @license MIT
// @match https://www.wanikani.com/subjects/*
// @match https://www.wanikani.com/subject-lessons/*
// @run-at document-idle
// @supportURL https://github.com/bfricka/wk-keyboard-focus
// @version 1.0.0
// ==/UserScript==

type Listener = (ev: Event) => void
type ListenerMap = { [eventName: string]: Set<Listener> }
type BodyListenerMap = { [eventNameCaptureKey: string]: Listener }
type WKMutationCallback = (item: MutationRecord) => boolean | undefined | void
;(() => {
	'use strict'
	let debug = false
	const SUBTREE = { childList: true, subtree: true } satisfies MutationObserverInit
	const isElement = (node: Node | null): node is HTMLElement => node?.nodeType === 1
	const hasClass = (node: Node, cls: string): node is HTMLElement =>
		isElement(node) && node.classList.contains(cls)
	const noop = () => {}

	const log = (...v: any[]) => {
		if (debug) console.log('[WK-KB-FOCUS]', ...v)
	}

	enum State {
		MAIN = 0,
		MODAL = 1,
		NOTES = 2,
		POINTER = 3,
		LESSON_MODAL = 4,
	}

	const state = (() => {
		const enabledStates = Object.keys(State).map(() => true)

		return {
			disable(state: State, disable = true) {
				log('disabling', State[state])
				enabledStates[state] = !disable
			},

			enable(state: State, enabled = true) {
				log('enabling', State[state])
				enabledStates[state] = enabled
			},

			isEnabled: (state?: State) => {
				if (state != null) return enabledStates[state]
				return enabledStates.every((v) => v)
			},
		}
	})()

	class WKObserver {
		#cb: WKMutationCallback = noop
		#isRunning = false
		#observer = new MutationObserver((items) => {
			for (const item of items) {
				if (this.#cb(item) === false) return
			}
		})

		get running() {
			return this.#isRunning
		}

		dispose = () => {
			this.#cb = noop
			this.#observer.disconnect()
			this.#isRunning = false
			return this
		}

		init = ($el: HTMLElement, cb: WKMutationCallback, opts?: MutationObserverInit) => {
			this.dispose()
			this.#cb = cb
			this.#observer.observe($el, opts)
			this.#isRunning = true
			return this
		}
	}

	const Observers = {
		info: new WKObserver(),
		meaningNotes: new WKObserver(),
		modal: new WKObserver(),
		modalInput: new WKObserver(),
		quizQueue: new WKObserver(),
		readingNotes: new WKObserver(),
		turbo: new WKObserver(),
	}

	const dispooseAll = () => {
		log('Disposing all observers and stopping')
		Object.values(Observers).forEach((o) => o.dispose())
	}

	const createEventDelegateListener =
		<T extends Event = Event>(matcher: (ev: T) => boolean, listener: (ev: T) => void) =>
		(ev: T) => {
			if (matcher(ev)) listener(ev)
		}

	const clsDelegateListener = <T extends Event = Event>(
		className: string,
		listener: (ev: T) => void,
	) =>
		createEventDelegateListener((ev) => {
			let currentNode: Element | null = ev.target as any

			while (currentNode) {
				if (currentNode.classList.contains(className)) return true
				currentNode = currentNode.parentElement
			}

			return false
		}, listener)

	const BodyDelegate = (() => {
		const bodyListenerMap: BodyListenerMap = {}
		const listenerMapCapture: ListenerMap = {}
		const listenerMap: ListenerMap = {}

		const dispose = () => {
			for (const [k, listener] of Object.entries(bodyListenerMap)) {
				const [type, captureStr] = k.split('|')
				const capture = captureStr === 'true'

				document.body.removeEventListener(type, listener, { capture })
			}
		}

		const on = <K extends keyof HTMLElementEventMap>(
			type: K,
			listener: Listener,
			capture = false,
		) => {
			const lm = capture ? listenerMapCapture : listenerMap
			let listeners = lm[type]

			if (!listeners) {
				listeners = lm[type] = new Set()

				const bodyListener = (bodyListenerMap[`${type}|${capture}`] = (ev: Event) => {
					if (state.isEnabled(State.MAIN)) listeners.forEach((l) => l(ev))
				})

				document.body.addEventListener(type, bodyListener, { capture })
			}

			listeners.add(listener)
		}

		const off = <K extends keyof HTMLElementEventMap>(
			type: K,
			listener: Listener,
			capture = false,
		) => {
			const listeners = (capture ? listenerMapCapture : listenerMap)[type]

			if (!listeners) return

			listeners.delete(listener)

			if (!listeners.size) {
				const bodyListener = bodyListenerMap[`${type}|${capture}`]

				if (bodyListener) {
					document.body.removeEventListener(type, bodyListener, { capture })
				}
			}
		}

		return { dispose, on, off }
	})()

	// Relative position container
	const addGlassesBtn = (() => {
		const $btn = document.createElement('button') as HTMLButtonElement
		$btn.type = 'button'
		$btn.classList.add('wk-focus__btn')
		$btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path class="wk-focus__glasses-icon" d="M224 232a32 32 0 0164 0M448 200h16M64 200H48M64 200c0 96 16 128 80 128s80-32 80-128c0 0-16-16-80-16s-80 16-80 16zM448 200c0 96-16 128-80 128s-80-32-80-128c0 0 16-16 80-16s80 16 80 16z" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="32"/></svg>`

		const $styles = document.createElement('style')
		$styles.textContent = `
    .wk-focus__btn {
      position: absolute;
      height: 1.5rem;
      width: 1.5rem;
      top: 50%;
      left: 1.5rem;
      transform: translateY(-50%);
      appearance: none;
      background: none;
      cursor: pointer;
    }

    .wk-focus__btn.wk-focus__fade {
      opacity: 0.5;
    }
    
    .wk-focus__glasses-icon {
      stroke: #111;
    }

    .quiz-input__input-container[correct=false] .wk-focus__glasses-icon {
      stroke: #fff;
    }

    .quiz-input__input-container[correct=true] .wk-focus__glasses-icon {
      stroke: #fff;
    }`

		let handler: (ev: MouseEvent) => void = noop

		const dispose = () => {
			$btn.removeEventListener('click', handler)
			$btn.remove()
			$styles.remove()
			handler = noop
		}

		const toggleEnabled = (overrideEnable?: boolean) => {
			const shouldEnable = overrideEnable ?? !state.isEnabled(State.MAIN)

			if (shouldEnable) state.enable(State.MAIN)
			else state.disable(State.MAIN)

			$btn.classList.toggle('wk-focus__fade', !shouldEnable)
		}

		return ($inputOffsetParent: HTMLElement) => {
			dispose()
			$inputOffsetParent.append($btn)
			document.body.append($styles)
			let clicks = 0
			let timeoutId = -1

			handler = (ev) => {
				clicks++
				ev.preventDefault()
				toggleEnabled()
				inputManager.focus()
				clearTimeout(timeoutId)

				timeoutId = setTimeout(() => {
					clicks = 0
				}, 500)

				if (clicks >= 4) {
					clicks = 0
					debug = !debug
					clearTimeout(timeoutId)
					toggleEnabled(true)
					console.log('[WK-KB-FOCUS]', 'Toggling debug', debug)
				}
			}

			$btn.addEventListener('click', handler)
		}
	})()

	const initModalObserver = ($modal: HTMLElement) => {
		log('Initializing modal observer')
		const findAutofocusInput = () => [...$modal.querySelectorAll('input')].find(($i) => $i.autofocus)

		const foundAndFocused = () => {
			const $autofocusInput = findAutofocusInput()

			if ($autofocusInput) {
				$autofocusInput.focus()
				Observers.modalInput.dispose()
				log('Found modal autofocus input', $autofocusInput)
				return true
			}

			log('Could not find modal autofocus input')
			return false
		}

		const initInputObserverAndFocus = () => {
			if (Observers.modalInput.running || foundAndFocused()) return

			Observers.modalInput.init(
				$modal,
				(item) => {
					if (item.addedNodes.length) return !foundAndFocused()
				},
				SUBTREE,
			)
		}

		Observers.modalInput.dispose()
		Observers.modal.init(
			$modal,
			(item) => {
				const $el = item.target

				if (!(isElement($el) && item.attributeName === 'hidden')) return

				if ($el.hidden) {
					Observers.modalInput.dispose()
					state.enable(State.MODAL)
					inputManager.focus()
					log('Modal hidden. Re-setting focus')
					return
				}

				log('Modal visible. Trying to find autofocus input.')
				state.disable(State.MODAL)
				initInputObserverAndFocus()
				// const $modalInput = $el.querySelector('input.wk-form__input') as HTMLInputElement | null
				// $modalInput?.focus()
			},
			{ attributeFilter: ['hidden'] },
		)
	}

	const initInfoObserver = ($subjectInfo: HTMLElement) => {
		log('Initializing subject info observer')
		let lastSrc = ''

		const findNoteForm = (nodes: NodeList): HTMLElement | undefined =>
			[...nodes].find(
				(node): node is HTMLElement => isElement(node) && node.classList.contains('user-note__form'),
			)

		const initNoteObserver = ($notesEl: HTMLElement | null, observer: WKObserver) => {
			if (!$notesEl) {
				observer.dispose()
				return
			}

			if (observer.running) return

			observer.init(
				$notesEl,
				({ addedNodes, removedNodes }) => {
					const $addedNoteForm = findNoteForm(addedNodes)

					if ($addedNoteForm) {
						state.disable(State.NOTES)
						;(
							$addedNoteForm.querySelector('textarea.user-note__input') as HTMLTextAreaElement | null
						)?.focus()

						return false
					}

					if (findNoteForm(removedNodes)) {
						state.enable(State.NOTES)
						inputManager.focus()
						return false
					}
				},
				SUBTREE,
			)
		}

		Observers.meaningNotes.dispose()
		Observers.readingNotes.dispose()
		Observers.info.init(
			$subjectInfo,
			({ attributeName, target, type }) => {
				if (type !== 'attributes' || attributeName !== 'data-loaded' || !isElement(target)) return

				const rawValue = target.attributes.getNamedItem(attributeName)?.value
				const isLoaded = rawValue === 'true'

				if (isLoaded) {
					initNoteObserver(document.getElementById('user_meaning_note'), Observers.meaningNotes)
					initNoteObserver(document.getElementById('user_reading_note'), Observers.readingNotes)
				} else {
					Observers.meaningNotes.dispose()
					Observers.readingNotes.dispose()
				}
			},
			{ attributeFilter: ['data-loaded'] },
		)
	}

	const initQuizQueueObserver = ($quizQueue: HTMLElement) => {
		log('Initializing quiz queue observer')

		const findLessonModal = (nodes: NodeList) =>
			[...nodes].find(
				(node): node is HTMLElement => isElement(node) && node.classList.contains('lesson-modal'),
			)

		Observers.quizQueue.init(
			$quizQueue,
			(item) => {
				const $addedLessonModal = findLessonModal(item.addedNodes)

				if ($addedLessonModal) {
					const $nextBtn = $addedLessonModal.querySelector(
						'.lesson-modal__button[data-default="true"] > a',
					) as HTMLAnchorElement | null

					state.disable(State.LESSON_MODAL)
					$nextBtn?.focus()
					return false
				}

				const $removedLessonModal = findLessonModal(item.removedNodes)

				if ($removedLessonModal) {
					$quizQueue.focus()
					state.enable(State.LESSON_MODAL)
				}
			},
			SUBTREE,
		)
	}

	const inputManager = (() => {
		let $input: HTMLInputElement | null = null
		let $inputOffsetParent: HTMLElement | null = null
		let $scrollContainer: HTMLElement | null = null
		let focusInput: (() => void) | null = null

		const getScroll = () => {
			if ($scrollContainer) return $scrollContainer

			$scrollContainer = document.querySelector('[data-controller=scrollable]')

			return $scrollContainer || document.body
		}

		const dispose = () => {
			BodyDelegate.dispose()
			$input = null
			$inputOffsetParent = null
			$scrollContainer = null
			focusInput = null
		}

		const init = ($initInput: HTMLInputElement) => {
			log('Initializing input manager')
			dispose()
			$input = $initInput
			$inputOffsetParent = $initInput.offsetParent as HTMLElement

			focusInput = () => {
				const scrollPos = getScroll().scrollTop
				$input?.focus()
				getScroll().scrollTop = scrollPos
			}

			addGlassesBtn($inputOffsetParent)

			const disable = () => state.disable(State.POINTER)
			const enableTimeout = () =>
				setTimeout(() => {
					log('Re-enabling focus after pointer')
					state.enable(State.POINTER)

					if (state.isEnabled()) focusInput?.()
				})

			;[
				'subject-collocations__pattern-name',
				'subject-section__toggle',
				'user-synonyms__buttons',
			].forEach((cls) => {
				// Disable on pointer down so we can blur
				BodyDelegate.on('pointerdown', clsDelegateListener(cls, disable), true)
				// Re-enable + focus on pointer up
				BodyDelegate.on('pointercancel', clsDelegateListener(cls, enableTimeout), true)
				BodyDelegate.on('pointerup', clsDelegateListener(cls, enableTimeout), true)
			})

			$input.addEventListener('blur', () => {
				const isEnabled = state.isEnabled()

				log('Input blur', isEnabled)

				if (isEnabled) focusInput?.()
			})

			focusInput()
		}

		const update = ($nextInput: HTMLInputElement | null) => {
			if ($nextInput) {
				if (!$input) init($nextInput)

				return
			}

			if ($input) dispose()
		}

		return {
			focus() {
				focusInput?.()
			},
			get running() {
				return Boolean(focusInput)
			},
			update,
		}
	})()

	const initTurboObserver = ($turboBody: HTMLElement) => {
		dispooseAll()
		// FIXME: Maybe interval watch for user input??
		const updateUserInput = () => {
			// Main input element for answers
			inputManager.update(document.getElementById('user-response') as HTMLInputElement | null)
		}

		const updateQuizQueue = () => {
			// Contains lesson modal ("Next batch, please!")
			const $quizQueue = document.getElementById('quiz-queue')

			if ($quizQueue) {
				Observers.quizQueue.running || initQuizQueueObserver($quizQueue)
			} else if (Observers.quizQueue.running) {
				state.enable(State.LESSON_MODAL)
				Observers.quizQueue.dispose()
			}
		}

		const updateSubjectInfo = () => {
			// Main "additional information" turbo module
			const $subjectInfo = document.getElementById('subject-info')

			if ($subjectInfo) {
				Observers.info.running || initInfoObserver($subjectInfo)
			} else if (Observers.info.running) {
				state.enable(State.NOTES)
				Observers.info.dispose()
			}
		}

		const isEgg = (node: Node) => isElement(node) && node.id === 'egg_timer'

		Observers.turbo.init(
			$turboBody,
			(item) => {
				// Superfluous egg timer runs every second
				if (isEgg(item.target)) return

				updateUserInput()
				updateQuizQueue()
				updateSubjectInfo()

				for (const node of item.addedNodes) {
					if (hasClass(node, 'wk-modal')) {
						initModalObserver(node)
						break
					}
				}

				for (const node of item.removedNodes) {
					if (hasClass(node, 'wk-modal')) {
						state.enable(State.MODAL)
						Observers.modal.dispose()
					}
				}
			},
			SUBTREE,
		)

		updateUserInput()
		updateQuizQueue()
		updateSubjectInfo()
		const $modal = document.querySelector('.wk-modal') as HTMLElement | null
		$modal && initModalObserver($modal)
	}

	let $lastTurboBody: HTMLElement | null = null

	const tryRun = () => {
		const $turboBody = document.getElementById('turbo-body')

		if ($turboBody) {
			// If we have the user input, make sure we're running
			if (Observers.turbo.running && $lastTurboBody === $turboBody) return

			$lastTurboBody = $turboBody
			initTurboObserver($turboBody)
		} else if (Observers.turbo.running) {
			dispooseAll()
		}
	}

	setInterval(tryRun, 200)
	tryRun()
})()
