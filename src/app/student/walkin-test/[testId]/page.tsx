'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import QuestionText from '@/components/QuestionText'
import { Clock, AlertTriangle, ChevronLeft, ChevronRight, CheckCircle, Flag, Zap } from 'lucide-react'

interface Question {
  id: string; questionText: string; optionA: string; optionB: string;
  optionC: string; optionD: string; area: string; weightage: number;
}

interface Answer { [questionId: string]: string }
interface Violation { questionId: string; type: string; timestamp: string }

export default function WalkInTestPage() {
  const { testId } = useParams()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [testData, setTestData] = useState<any>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [questionCount, setQuestionCount] = useState(0)
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Answer>({})
  const [currentIdx, setCurrentIdx] = useState(0)
  const [violations, setViolations] = useState<Violation[]>([])
  const [timeLeft, setTimeLeft] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [testStarted, setTestStarted] = useState(false)
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)
  const timerRef = useRef<NodeJS.Timeout>()
  const startTimeRef = useRef<number>(0)

  // Load test data
  useEffect(() => {
    fetch(`/api/student/walkin-test/${testId}`)
      .then(r => {
        if (!r.ok && r.status !== 400) throw new Error(`Server error (${r.status})`)
        return r.text()
      })
      .then(text => {
        if (!text) throw new Error('Empty response from server')
        const data = JSON.parse(text)
        if (data.error) { toast.error(data.error); router.push('/student'); return }
        setTestData(data.test)
        setQuestions(data.questions || [])
        setQuestionCount(data.questionCount ?? 0)
        if (data.attemptId) setAttemptId(data.attemptId)

        if (data.isSubmitted) {
          setSubmitted(true)
        } else if (data.started) {
          // Resume. Remaining time is server-authoritative — a reload must not
          // hand the student a fresh clock.
          setTimeLeft(data.remainingSeconds ?? 0)
          const questionIds = new Set((data.questions || []).map((q: any) => q.id))
          const filtered: Record<string, string> = {}
          for (const [qId, ans] of Object.entries(data.savedAnswers || {})) {
            if (questionIds.has(qId)) filtered[qId] = ans as string
          }
          setAnswers(filtered)
          setTestStarted(true)
        }
        setLoading(false)
      })
      .catch((err) => { toast.error(err.message || 'Failed to load test. Please refresh the page.', { duration: 5000 }); setLoading(false) })
  }, [testId])

  // Tab/window focus detection
  useEffect(() => {
    if (!testStarted || submitted) return

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        recordViolation('TAB_SWITCH')
      }
    }

    const handleBlur = () => { recordViolation('WINDOW_BLUR') }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('blur', handleBlur)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('blur', handleBlur)
    }
  }, [testStarted, submitted, currentIdx])

  // A single alt-tab fires both `visibilitychange` and `blur`, so the raw
  // handlers reported the same event twice - two writes and two toasts per
  // switch. Collapse anything inside this window into one report.
  const VIOLATION_THROTTLE_MS = 3000
  const lastViolationRef = useRef(0)

  function recordViolation(type: string) {
    const now = Date.now()
    if (now - lastViolationRef.current < VIOLATION_THROTTLE_MS) return
    lastViolationRef.current = now
    const currentQuestion = questions[currentIdx]
    if (!currentQuestion) return
    const v: Violation = {
      questionId: currentQuestion.id,
      type,
      timestamp: new Date().toISOString()
    }
    setViolations(prev => {
      const updated = [...prev, v]
      if (attemptId) {
        fetch(`/api/student/walkin-test/${testId}/violation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attemptId, violation: v })
        })
      }
      return updated
    })
    toast.error('⚠️ Tab/Window switch detected!', { duration: 3000 })
  }

  // Timer
  useEffect(() => {
    if (!testStarted || submitted) return

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current)
          handleAutoSubmit()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timerRef.current)
  }, [testStarted, submitted])

  async function startTest() {
    try {
      // No body: the server chooses the question set and starts the clock.
      const res = await fetch(`/api/student/walkin-test/${testId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setAttemptId(data.attemptId)
      setQuestions(data.questions || [])
      setQuestionCount((data.questions || []).length)
      setAnswers(data.savedAnswers || {})
      setTimeLeft(data.remainingSeconds ?? 0)
      setTestStarted(true)
      startTimeRef.current = Date.now()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const saveTimerRef = useRef<NodeJS.Timeout>()
  const pendingSavesRef = useRef<Record<string, string>>({})

  function flushSaves() {
    const saves = { ...pendingSavesRef.current }
    pendingSavesRef.current = {}
    if (Object.keys(saves).length === 0 || !attemptId) return
    fetch(`/api/student/walkin-test/${testId}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attemptId, answers: saves })
    }).catch(() => {})
  }

  function selectAnswer(questionId: string, answer: string) {
    setAnswers(prev => {
      const updated = { ...prev, [questionId]: answer }
      // Debounced batch save — collects answers for 2s then saves all at once
      pendingSavesRef.current[questionId] = answer
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(flushSaves, 2000)
      return updated
    })
  }

  function getFilteredAnswers() {
    const validIds = new Set(questions.map(q => q.id))
    const filtered: Record<string, string> = {}
    for (const [qId, ans] of Object.entries(answers)) {
      if (validIds.has(qId)) filtered[qId] = ans
    }
    return filtered
  }

  async function submitWithRetry(maxRetries = 3): Promise<boolean> {
    // Flush any pending auto-saves before submitting
    clearTimeout(saveTimerRef.current)
    flushSaves()
    const payload = { attemptId, answers: getFilteredAnswers(), violations }
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await fetch(`/api/student/walkin-test/${testId}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        const data = await res.json()
        if (data.success) return true
        if (res.status === 400 && data.error === 'Already submitted') return true
        // Server error — retry
        if (res.status >= 500 && attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          continue
        }
        throw new Error(data.error || 'Submit failed')
      } catch (err: any) {
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          continue
        }
        throw err
      }
    }
    return false
  }

  async function handleAutoSubmit() {
    if (!attemptId || submitted) return
    // Everyone who started together reaches zero in the same second. A short
    // random delay spreads that thundering herd across the submit endpoint;
    // the server grades on its own deadline, so the wait costs no marks.
    await new Promise(r => setTimeout(r, Math.floor(Math.random() * 4000)))
    setSubmitting(true)
    try {
      const ok = await submitWithRetry()
      if (ok) { setSubmitted(true); toast.success('Time up! Test submitted automatically.') }
    } catch {
      toast.error('Auto-submit failed. Click "Submit Test" to retry.')
    }
    setSubmitting(false)
  }

  async function handleSubmit() {
    if (!attemptId) return
    setSubmitting(true)
    setShowSubmitConfirm(false)
    try {
      const ok = await submitWithRetry()
      if (ok) {
        setSubmitted(true)
        clearInterval(timerRef.current)
        toast.success('Test submitted successfully!')
      }
    } catch (err: any) {
      toast.error('Submit failed. Your answers are saved. Please try again.', { duration: 5000 })
    } finally {
      setSubmitting(false)
    }
  }

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const currentQ = questions[currentIdx]
  const questionIdSet = new Set(questions.map(q => q.id))
  const answeredCount = Object.keys(answers).filter(id => questionIdSet.has(id)).length
  const flaggedQs = new Set(violations.map(v => v.questionId))
  const violationCounts: Record<string, number> = {}
  violations.forEach(v => { violationCounts[v.questionId] = (violationCounts[v.questionId] || 0) + 1 })

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-brand-purple border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500">Loading test...</p>
        </div>
      </div>
    )
  }

  if (!testData && !loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="card max-w-sm w-full text-center">
          <p className="text-red-500 font-medium mb-2">Failed to load test</p>
          <p className="text-gray-500 text-sm mb-4">Server may be busy. Please try again.</p>
          <button onClick={() => window.location.reload()} className="btn-primary w-full justify-center">
            Retry
          </button>
        </div>
      </div>
    )
  }

  // Instructions / Start Screen
  if (!testStarted && !submitted) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="card max-w-lg w-full">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Zap size={32} className="text-orange-500" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800">{testData?.title}</h1>
            <p className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full inline-flex items-center gap-1 mt-2">
              <Zap size={10} /> Walk-in Test
            </p>
          </div>

          <div className="space-y-3 mb-6">
            {[
              ['Duration', `${testData?.durationMinutes} minutes`],
              ['Total Questions', `${questionCount} questions`],
              ['Total Marks', `${testData?.totalMarks} marks`],
              ['Passing Marks', `${testData?.passingMarks} marks`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-sm text-gray-500">{label}</span>
                <span className="text-sm font-semibold text-gray-800">{value}</span>
              </div>
            ))}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <p className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-2">
              <AlertTriangle size={16} /> Important Instructions
            </p>
            <ul className="text-sm text-amber-700 space-y-1 list-disc list-inside">
              <li>Do not switch tabs or windows during the test</li>
              <li>Tab switches are detected and flagged on the question</li>
              <li>You can navigate between questions freely</li>
              <li>Ensure stable internet connection before starting</li>
              <li>Once submitted, you cannot change answers</li>
              <li>Timer starts as soon as you click "Start Test"</li>
            </ul>
          </div>

          <button onClick={startTest} className="btn-primary w-full justify-center py-3 text-base">
            🚀 Start Test
          </button>
        </div>
      </div>
    )
  }

  // Submitted screen
  if (submitted) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="card max-w-md w-full text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={40} className="text-green-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Test Submitted!</h1>
          <p className="text-gray-500 mt-2">Your responses have been recorded successfully.</p>
          <p className="text-gray-400 text-sm mt-1">Answered {answeredCount} of {questions.length} questions</p>
          {violations.length > 0 && (
            <div className="mt-4 bg-amber-50 rounded-lg p-3 text-sm text-amber-700">
              ⚠️ {violations.length} tab/window switch(es) were detected during the test.
            </div>
          )}
          <button onClick={() => router.push('/student')} className="btn-primary mt-6 w-full justify-center">
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  // Active Test UI
  return (
    <div className="h-screen flex flex-col bg-gray-100" onContextMenu={e => e.preventDefault()}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 bg-brand-purple text-white shadow-lg">
        <div>
          <div className="font-semibold text-sm flex items-center gap-2">
            {testData?.title}
            <span className="text-xs bg-orange-500/30 text-orange-200 px-1.5 py-0.5 rounded text-[10px]">WALK-IN</span>
          </div>
          <div className="text-xs text-white/70">Question {currentIdx + 1} of {questions.length}</div>
        </div>

        <div className="flex items-center gap-4">
          {violations.length > 0 && (
            <div className="flex items-center gap-1.5 bg-orange-500/20 text-orange-200 px-3 py-1.5 rounded-lg text-xs">
              <AlertTriangle size={13} /> {violations.length} violation{violations.length > 1 ? 's' : ''}
            </div>
          )}
          <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono font-bold ${timeLeft < 300 ? 'bg-red-500/30 text-red-200' : 'bg-white/10'}`}>
            <Clock size={16} /> {formatTime(timeLeft)}
          </div>
          <span className="text-xs text-white/60">{answeredCount}/{questions.length} answered</span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Question Panel */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {currentQ && (
            <div className={`card max-w-2xl mx-auto ${flaggedQs.has(currentQ.id) ? 'question-flagged' : ''}`}>
              {flaggedQs.has(currentQ.id) && (
                <div className="flex items-center gap-2 text-orange-600 text-xs mb-3 bg-orange-50 rounded-lg p-2">
                  <Flag size={13} />
                  Tab switch detected {violationCounts[currentQ.id] || 1} time(s) during this question
                </div>
              )}

              <div className="flex items-start gap-3 mb-5">
                <span className="bg-brand-purple text-white text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  {currentIdx + 1}
                </span>
                <QuestionText text={currentQ.questionText} area={currentQ.area} className="text-gray-800 font-medium leading-relaxed min-w-0 flex-1" />
              </div>

              <div className="space-y-3">
                {(['A','B','C','D'] as const).map(opt => {
                  const text = (currentQ as any)[`option${opt}`]
                  const selected = answers[currentQ.id] === opt
                  return (
                    <button key={opt} onClick={() => selectAnswer(currentQ.id, opt)}
                      className={`w-full text-left flex items-center gap-3 p-4 rounded-xl border transition-all
                        ${selected
                          ? 'bg-brand-purple/10 border-brand-purple text-brand-purple font-medium'
                          : 'bg-gray-50 border-gray-200 hover:border-brand-purple/40 hover:bg-brand-purple/5 text-gray-700'
                        }`}>
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${selected ? 'bg-brand-purple text-white' : 'bg-white border border-gray-300 text-gray-500'}`}>
                        {opt}
                      </span>
                      {text}
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
                <button onClick={() => setCurrentIdx(i => Math.max(0, i - 1))}
                  disabled={currentIdx === 0}
                  className="btn-secondary flex items-center gap-2 disabled:opacity-40">
                  <ChevronLeft size={16} /> Previous
                </button>
                {currentIdx === questions.length - 1 ? (
                  <button onClick={() => setShowSubmitConfirm(true)}
                    className="btn-teal flex items-center gap-2 px-6">
                    Submit Test
                  </button>
                ) : (
                  <button onClick={() => setCurrentIdx(i => Math.min(questions.length - 1, i + 1))}
                    className="btn-primary flex items-center gap-2">
                    Next <ChevronRight size={16} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Question Navigator */}
        <div className="hidden md:block w-56 bg-white border-l border-gray-200 overflow-y-auto p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Questions</div>
          <div className="grid grid-cols-5 gap-1.5">
            {questions.map((q, i) => {
              const answered = !!answers[q.id]
              const flagged = flaggedQs.has(q.id)
              const active = i === currentIdx
              return (
                <button key={q.id} onClick={() => setCurrentIdx(i)}
                  className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all relative
                    ${active ? 'bg-brand-purple text-white' :
                      answered ? 'bg-green-100 text-green-700 border border-green-300' :
                      'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}>
                  {i + 1}
                  {flagged && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-orange-400 rounded-full" />}
                </button>
              )
            })}
          </div>
          <div className="mt-4 space-y-1.5 text-xs text-gray-500">
            <div className="flex items-center gap-2"><div className="w-4 h-4 bg-green-100 border border-green-300 rounded" /> Answered</div>
            <div className="flex items-center gap-2"><div className="w-4 h-4 bg-gray-100 rounded" /> Not answered</div>
            <div className="flex items-center gap-2 relative">
              <div className="w-4 h-4 bg-gray-100 rounded relative">
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-orange-400 rounded-full" />
              </div> Tab switch
            </div>
          </div>
          <button onClick={() => setShowSubmitConfirm(true)}
            className="btn-teal w-full justify-center mt-6 text-sm py-2">
            Submit Test
          </button>
        </div>
      </div>

      {/* Submit Confirm Modal */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-gray-800 mb-2">Submit Test?</h2>
            <p className="text-gray-500 text-sm mb-4">
              You have answered <strong>{answeredCount}</strong> of <strong>{questions.length}</strong> questions.
              {answeredCount < questions.length && (
                <span className="text-orange-500"> {questions.length - answeredCount} unanswered.</span>
              )}
            </p>
            <p className="text-sm text-red-600 mb-5">⚠️ Once submitted, you cannot change your answers.</p>
            <div className="flex gap-3">
              <button onClick={handleSubmit} disabled={submitting}
                className="btn-teal flex-1 justify-center">
                {submitting ? 'Submitting...' : 'Yes, Submit'}
              </button>
              <button onClick={() => setShowSubmitConfirm(false)} className="btn-secondary flex-1 justify-center">
                Review
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
