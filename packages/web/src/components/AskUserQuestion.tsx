import { useState } from 'react'

interface Question {
  question: string
  header: string
  options: Array<{
    label: string
    description?: string
  }>
  multiSelect: boolean
}

interface AskUserQuestionInput {
  questions: Question[]
}

interface AskUserQuestionProps {
  input: Record<string, unknown>
  onSubmit: (answers: Record<string, string[]>) => void
  onCancel: () => void
}

function parseInput(input: Record<string, unknown>): AskUserQuestionInput {
  const questions = Array.isArray(input.questions) ? input.questions : []
  return {
    questions: questions.map((q: any) => ({
      question: q.question || '',
      header: q.header || '',
      options: Array.isArray(q.options) ? q.options.map((opt: any) => ({
        label: opt.label || '',
        description: opt.description || undefined
      })) : [],
      multiSelect: !!q.multiSelect
    }))
  }
}

export function AskUserQuestion({ input, onSubmit, onCancel }: AskUserQuestionProps) {
  const parsed = parseInput(input)
  const questions = parsed.questions

  const [currentStep, setCurrentStep] = useState(0)
  const [selectedByQuestion, setSelectedByQuestion] = useState<number[][]>(
    questions.map(() => [])
  )
  const [otherSelectedByQuestion, setOtherSelectedByQuestion] = useState<boolean[]>(
    questions.map(() => false)
  )
  const [otherTextByQuestion, setOtherTextByQuestion] = useState<string[]>(
    questions.map(() => '')
  )

  if (questions.length === 0) {
    return (
      <div className="bg-blue-900/50 border-t border-blue-700 p-4">
        <div className="text-sm text-blue-200 mb-3">
          Claude is asking a question but no options were provided.
        </div>
        <textarea
          className="w-full bg-slate-800 text-slate-200 border border-slate-600 rounded-lg p-2 text-sm"
          placeholder="Type your answer..."
          value={otherTextByQuestion[0] || ''}
          onChange={(e) => {
            const newTexts = [...otherTextByQuestion]
            newTexts[0] = e.target.value
            setOtherTextByQuestion(newTexts)
          }}
          rows={3}
        />
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => {
              const text = otherTextByQuestion[0]?.trim()
              if (text) {
                onSubmit({ '0': [text] })
              }
            }}
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 px-4 rounded-lg text-sm font-medium"
          >
            Submit
          </button>
          <button
            onClick={onCancel}
            className="flex-1 bg-slate-600 hover:bg-slate-500 text-white py-2 px-4 rounded-lg text-sm font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  const currentQuestion = questions[currentStep]
  const isMulti = currentQuestion.multiSelect
  const selectedOptions = selectedByQuestion[currentStep] || []
  const otherSelected = otherSelectedByQuestion[currentStep] || false
  const otherText = otherTextByQuestion[currentStep] || ''

  const toggleOption = (optIdx: number) => {
    setSelectedByQuestion(prev => {
      const next = [...prev]
      const current = new Set(next[currentStep] || [])

      if (isMulti) {
        if (current.has(optIdx)) {
          current.delete(optIdx)
        } else {
          current.add(optIdx)
        }
        next[currentStep] = Array.from(current).sort((a, b) => a - b)
      } else {
        next[currentStep] = [optIdx]
        // Deselect "Other" when selecting an option in single-select mode
        setOtherSelectedByQuestion(prev => {
          const newOther = [...prev]
          newOther[currentStep] = false
          return newOther
        })
      }
      return next
    })
  }

  const toggleOther = () => {
    if (!isMulti) {
      // Single select: deselect all options
      setSelectedByQuestion(prev => {
        const next = [...prev]
        next[currentStep] = []
        return next
      })
    }
    setOtherSelectedByQuestion(prev => {
      const next = [...prev]
      next[currentStep] = !next[currentStep]
      return next
    })
  }

  const updateOtherText = (value: string) => {
    setOtherTextByQuestion(prev => {
      const next = [...prev]
      next[currentStep] = value
      return next
    })
    // Auto-select "Other" when typing
    if (value.trim() && !otherSelected) {
      setOtherSelectedByQuestion(prev => {
        const next = [...prev]
        next[currentStep] = true
        return next
      })
    }
  }

  const getAnswersForQuestion = (idx: number): string[] => {
    const answers: string[] = []
    const q = questions[idx]
    const selected = selectedByQuestion[idx] || []

    for (const optIdx of selected) {
      const opt = q.options[optIdx]
      if (opt) {
        answers.push(opt.label)
      }
    }

    if (otherSelectedByQuestion[idx] && otherTextByQuestion[idx]?.trim()) {
      answers.push(otherTextByQuestion[idx].trim())
    }

    return answers
  }

  const canProceed = () => {
    return getAnswersForQuestion(currentStep).length > 0
  }

  const handleNext = () => {
    if (canProceed() && currentStep < questions.length - 1) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSubmit = () => {
    const answers: Record<string, string[]> = {}
    for (let i = 0; i < questions.length; i++) {
      const a = getAnswersForQuestion(i)
      if (a.length === 0) {
        // Go to unanswered question
        setCurrentStep(i)
        return
      }
      answers[String(i)] = a
    }
    onSubmit(answers)
  }

  return (
    <div className="bg-blue-900/50 border-t border-blue-700 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded">
            Question
          </span>
          {currentQuestion.header && (
            <span className="text-blue-300 text-sm font-medium">
              {currentQuestion.header}
            </span>
          )}
        </div>
        <span className="text-blue-400 text-xs font-mono">
          [{currentStep + 1}/{questions.length}]
        </span>
      </div>

      {/* Question text */}
      {currentQuestion.question && (
        <div className="text-sm text-blue-100 mb-3">
          {currentQuestion.question}
        </div>
      )}

      {/* Options */}
      <div className="space-y-2 mb-4">
        {currentQuestion.options.map((opt, idx) => {
          const isSelected = selectedOptions.includes(idx)
          return (
            <button
              key={idx}
              onClick={() => toggleOption(idx)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                isSelected
                  ? 'bg-blue-800/50 border-blue-500'
                  : 'bg-slate-800/50 border-slate-600 hover:border-slate-500'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5">
                  {isMulti ? (isSelected ? '☑' : '☐') : (isSelected ? '●' : '○')}
                </span>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${isSelected ? 'text-blue-200' : 'text-slate-200'}`}>
                    {opt.label}
                  </div>
                  {opt.description && (
                    <div className="text-xs text-slate-400 mt-0.5">
                      {opt.description}
                    </div>
                  )}
                </div>
              </div>
            </button>
          )
        })}

        {/* Other option */}
        <button
          onClick={toggleOther}
          className={`w-full text-left p-3 rounded-lg border transition-colors ${
            otherSelected
              ? 'bg-blue-800/50 border-blue-500'
              : 'bg-slate-800/50 border-slate-600 hover:border-slate-500'
          }`}
        >
          <div className="flex items-start gap-2">
            <span className="text-blue-400 mt-0.5">
              {isMulti ? (otherSelected ? '☑' : '☐') : (otherSelected ? '●' : '○')}
            </span>
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-medium ${otherSelected ? 'text-blue-200' : 'text-slate-200'}`}>
                Other
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Type your own answer
              </div>
            </div>
          </div>
        </button>

        {/* Other text input */}
        {otherSelected && (
          <textarea
            className="w-full bg-slate-800 text-slate-200 border border-slate-600 rounded-lg p-2 text-sm mt-2"
            placeholder="Type your answer..."
            value={otherText}
            onChange={(e) => updateOtherText(e.target.value)}
            rows={2}
          />
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between gap-2">
        <div>
          {questions.length > 1 && currentStep > 0 && (
            <button
              onClick={handlePrev}
              className="bg-slate-600 hover:bg-slate-500 text-white py-2 px-4 rounded-lg text-sm font-medium"
            >
              ← Prev
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="bg-red-600 hover:bg-red-500 text-white py-2 px-4 rounded-lg text-sm font-medium"
          >
            Cancel
          </button>
          {currentStep < questions.length - 1 ? (
            <button
              onClick={handleNext}
              disabled={!canProceed()}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white py-2 px-4 rounded-lg text-sm font-medium"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canProceed()}
              className="bg-green-600 hover:bg-green-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white py-2 px-4 rounded-lg text-sm font-medium"
            >
              Submit
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
