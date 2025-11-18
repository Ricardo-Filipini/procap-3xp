
import React, { useState, useEffect, useMemo } from 'react';
import { MainContentProps, ProcapExamQuestion, UserExamAnswer } from '../../types';
import { getProcapQuestions, getUserExamAnswers, saveUserExamAnswer, deleteUserExamAnswer, getAllUserExamAnswers } from '../../services/supabaseClient';
import { CheckCircleIcon, XCircleIcon, XMarkIcon } from '../Icons';

export const OlhoNoProcapView: React.FC<MainContentProps> = ({ currentUser }) => {
    const [questions, setQuestions] = useState<ProcapExamQuestion[]>([]);
    const [userAnswers, setUserAnswers] = useState<UserExamAnswer[]>([]);
    const [allAnswers, setAllAnswers] = useState<UserExamAnswer[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedQuestion, setExpandedQuestion] = useState<number | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const [qData, uData, allData] = await Promise.all([
                    getProcapQuestions(),
                    getUserExamAnswers(currentUser.id),
                    getAllUserExamAnswers()
                ]);
                setQuestions(qData);
                setUserAnswers(uData);
                setAllAnswers(allData);
            } catch (error) {
                console.error("Error loading exam data:", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchData();
    }, [currentUser.id]);

    const handleSelectAnswer = async (qNum: number, answer: string) => {
        // Optimistic update
        const existingAnswer = userAnswers.find(a => a.question_number === qNum);
        if (existingAnswer?.selected_answer === answer) {
            // Deselect
            const newAnswers = userAnswers.filter(a => a.question_number !== qNum);
            setUserAnswers(newAnswers);
            await deleteUserExamAnswer(currentUser.id, qNum);
        } else {
            // Select/Change
            const newAnswer: UserExamAnswer = {
                id: `temp-${Date.now()}`,
                user_id: currentUser.id,
                question_number: qNum,
                selected_answer: answer,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            setUserAnswers(prev => {
                const filtered = prev.filter(a => a.question_number !== qNum);
                return [...filtered, newAnswer];
            });
            
            // Auto-advance logic
            const nextQuestionElement = document.getElementById(`q-card-${qNum + 1}`);
            if (nextQuestionElement) {
                nextQuestionElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            await saveUserExamAnswer(currentUser.id, qNum, answer);
        }
        
        // Refresh global stats in background
        getAllUserExamAnswers().then(setAllAnswers);
    };

    const calculateMajority = (qNum: number) => {
        const answersForQ = allAnswers.filter(a => a.question_number === qNum);
        if (answersForQ.length === 0) return null;
        
        const counts: Record<string, number> = {};
        let maxCount = 0;
        let majorityAnswer = '';
        
        answersForQ.forEach(a => {
            counts[a.selected_answer] = (counts[a.selected_answer] || 0) + 1;
            if (counts[a.selected_answer] > maxCount) {
                maxCount = counts[a.selected_answer];
                majorityAnswer = a.selected_answer;
            }
        });
        
        return { answer: majorityAnswer, count: maxCount, total: answersForQ.length, percentage: (maxCount / answersForQ.length) * 100 };
    };

    const stats = useMemo(() => {
        let aiCorrect = 0;
        let officialCorrect = 0;
        let majorityAgreement = 0;
        let answeredCount = 0;
        const totalOfficial = questions.filter(q => q.gabarito_preliminar).length;

        userAnswers.forEach(ua => {
            const q = questions.find(q => q.question_number === ua.question_number);
            if (q) {
                answeredCount++;
                if (ua.selected_answer === q.ai_correct_answer?.toLowerCase()) aiCorrect++;
                if (q.gabarito_preliminar && ua.selected_answer === q.gabarito_preliminar.toLowerCase()) officialCorrect++;
                
                const majority = calculateMajority(q.question_number);
                if (majority && ua.selected_answer === majority.answer) majorityAgreement++;
            }
        });

        return {
            ai: { correct: aiCorrect, total: answeredCount },
            official: { correct: officialCorrect, total: totalOfficial > 0 ? questions.filter(q=>q.gabarito_preliminar && userAnswers.some(a=>a.question_number===q.question_number)).length : 0 }, // Only count official comparisons if user answered AND official key exists
            majority: { agreement: majorityAgreement, total: answeredCount }
        };
    }, [userAnswers, questions, allAnswers]);

    const divergences = useMemo(() => {
        return questions.filter(q => {
            const ai = q.ai_correct_answer?.toLowerCase();
            const official = q.gabarito_preliminar?.toLowerCase();
            const majority = calculateMajority(q.question_number)?.answer;
            
            // Check for disagreements
            const aiVsOfficial = official && ai !== official;
            const officialVsMajority = official && majority && official !== majority;
            const aiVsMajority = majority && ai !== majority;
            
            return aiVsOfficial || officialVsMajority || aiVsMajority;
        });
    }, [questions, allAnswers]);

    if (isLoading) {
        return <div className="flex items-center justify-center h-full text-xl font-bold text-gray-500">Carregando Prova...</div>;
    }

    return (
        <div className="space-y-6 pb-20">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-card-light dark:bg-card-dark p-4 rounded-lg border border-border-light dark:border-border-dark shadow-sm flex flex-col items-center justify-center">
                    <h3 className="text-sm font-semibold text-gray-500 mb-1">Coincidência com IA</h3>
                    <div className="text-3xl font-bold text-primary-light">{stats.ai.correct} <span className="text-sm text-gray-400">/ {stats.ai.total}</span></div>
                    <div className="text-xs text-gray-400">{stats.ai.total > 0 ? ((stats.ai.correct / stats.ai.total) * 100).toFixed(1) : 0}%</div>
                </div>
                <div className="bg-card-light dark:bg-card-dark p-4 rounded-lg border border-border-light dark:border-border-dark shadow-sm flex flex-col items-center justify-center">
                    <h3 className="text-sm font-semibold text-gray-500 mb-1">Acerto Preliminar</h3>
                    <div className="text-3xl font-bold text-secondary-light">{stats.official.correct} <span className="text-sm text-gray-400">/ {stats.official.total}</span></div>
                    <div className="text-xs text-gray-400">{stats.official.total > 0 ? ((stats.official.correct / stats.official.total) * 100).toFixed(1) : 0}%</div>
                </div>
                <div className="bg-card-light dark:bg-card-dark p-4 rounded-lg border border-border-light dark:border-border-dark shadow-sm flex flex-col items-center justify-center">
                    <h3 className="text-sm font-semibold text-gray-500 mb-1">Com a Maioria</h3>
                    <div className="text-3xl font-bold text-purple-500">{stats.majority.agreement} <span className="text-sm text-gray-400">/ {stats.majority.total}</span></div>
                    <div className="text-xs text-gray-400">{stats.majority.total > 0 ? ((stats.majority.agreement / stats.majority.total) * 100).toFixed(1) : 0}%</div>
                </div>
            </div>

            {divergences.length > 0 && (
                <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg border border-red-200 dark:border-red-800">
                    <h3 className="font-bold text-red-700 dark:text-red-400 mb-2 flex items-center gap-2">
                         <XCircleIcon className="w-5 h-5"/> Divergências Encontradas ({divergences.length})
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        {divergences.map(q => (
                            <button 
                                key={q.id} 
                                onClick={() => document.getElementById(`q-card-${q.question_number}`)?.scrollIntoView({behavior: 'smooth', block: 'center'})}
                                className="px-2 py-1 bg-white dark:bg-gray-800 border border-red-300 dark:border-red-700 rounded text-sm hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
                            >
                                Q{q.question_number}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: 40 }, (_, i) => i + 1).map(num => {
                    const questionData = questions.find(q => q.question_number === num);
                    const userAnswer = userAnswers.find(u => u.question_number === num)?.selected_answer;
                    const majority = calculateMajority(num);
                    
                    // Parse options if they exist as string
                    let optionsMap: any = null;
                    if (questionData?.options) {
                         try {
                             optionsMap = typeof questionData.options === 'string' ? JSON.parse(questionData.options) : questionData.options;
                         } catch (e) {
                             console.error("Error parsing options", e);
                         }
                    }

                    return (
                        <div id={`q-card-${num}`} key={num} className={`relative bg-card-light dark:bg-card-dark rounded-lg border shadow-sm flex flex-col transition-all ${userAnswer ? 'border-primary-light dark:border-primary-dark' : 'border-border-light dark:border-border-dark'}`}>
                            <div className="p-3 border-b border-border-light dark:border-border-dark flex justify-between items-center bg-gray-50 dark:bg-gray-800/50 rounded-t-lg">
                                <span className="font-bold text-lg">Questão {num}</span>
                                <div className="flex gap-1 text-xs">
                                    {questionData?.ai_correct_answer && <span title="Gabarito IA" className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">AI: {questionData.ai_correct_answer.toUpperCase()}</span>}
                                    {questionData?.gabarito_preliminar && <span title="Gabarito Preliminar" className="px-1.5 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Off: {questionData.gabarito_preliminar.toUpperCase()}</span>}
                                    {majority && majority.count > 1 && <span title="Maioria" className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">{majority.percentage.toFixed(0)}% {majority.answer.toUpperCase()}</span>}
                                </div>
                            </div>
                            
                            <div className="p-4 flex-grow flex flex-col justify-between gap-4">
                                {questionData?.question_text ? (
                                    <div>
                                        <p className={`text-sm ${expandedQuestion === num ? '' : 'line-clamp-3'}`} onClick={() => setExpandedQuestion(expandedQuestion === num ? null : num)}>
                                            {questionData.question_text}
                                        </p>
                                        {optionsMap && expandedQuestion === num && (
                                            <div className="mt-2 text-xs space-y-1 text-gray-600 dark:text-gray-300 border-t pt-2 border-gray-200 dark:border-gray-700">
                                                {Object.entries(optionsMap).map(([key, val]: [string, any]) => (
                                                    <div key={key} className={userAnswer === key ? 'font-bold text-primary-light' : ''}>
                                                        <span className="uppercase font-bold">{key})</span> {val}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="text-sm text-gray-400 italic text-center py-4">Texto da questão não disponível</div>
                                )}

                                <div className="flex justify-between items-center mt-auto">
                                    {['a', 'b', 'c', 'd', 'e'].map(opt => {
                                        const isSelected = userAnswer === opt;
                                        const isAi = questionData?.ai_correct_answer?.toLowerCase() === opt;
                                        const isOfficial = questionData?.gabarito_preliminar?.toLowerCase() === opt;
                                        
                                        // Conflict Logic colors
                                        let ringColor = 'ring-gray-200 dark:ring-gray-700';
                                        if (isOfficial) ringColor = 'ring-green-500 ring-2';
                                        else if (isAi && !questionData?.gabarito_preliminar) ringColor = 'ring-blue-400 ring-2';

                                        return (
                                            <button
                                                key={opt}
                                                onClick={() => handleSelectAnswer(num, opt)}
                                                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all shadow-sm ring-offset-1 dark:ring-offset-gray-800 ${ringColor}
                                                    ${isSelected 
                                                        ? 'bg-primary-light dark:bg-primary-dark text-white scale-110' 
                                                        : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
                                                    }
                                                `}
                                            >
                                                {opt.toUpperCase()}
                                                {/* Small indicator dots for feedback without selection */}
                                                <div className="absolute -bottom-1 flex gap-0.5">
                                                    {/* If selected matched official */}
                                                    {isSelected && isOfficial && <span className="block w-1 h-1 rounded-full bg-white"></span>}
                                                </div>
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
