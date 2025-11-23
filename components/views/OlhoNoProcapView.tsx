
import React, { useState, useEffect, useMemo } from 'react';
import { MainContentProps, ProcapExamQuestion, UserExamAnswer } from '../../types';
import { getProcapQuestions, getUserExamAnswers, saveUserExamAnswer, deleteUserExamAnswer, getAllUserExamAnswers } from '../../services/supabaseClient';
import { XCircleIcon, CheckCircleIcon, LightBulbIcon } from '../Icons';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { FontSizeControl, FONT_SIZE_CLASSES_LARGE } from '../shared/FontSizeControl';

export const OlhoNoProcapView: React.FC<MainContentProps> = ({ currentUser }) => {
    const [questions, setQuestions] = useState<ProcapExamQuestion[]>([]);
    const [userAnswers, setUserAnswers] = useState<UserExamAnswer[]>([]);
    const [allAnswers, setAllAnswers] = useState<UserExamAnswer[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedQuestion, setExpandedQuestion] = useState<number | null>(null);
    
    // New States
    const [comparisonMode, setComparisonMode] = useState<'official' | 'ai' | 'majority'>('official');
    const [fontSize, setFontSize] = useState(1); // Default slightly larger (Index 1 in LARGE array)

    useEffect(() => {
        let isMounted = true;

        const loadData = async () => {
            setIsLoading(true);
            try {
                // 1. Carregamento Crítico: Questões e Respostas do Usuário (Rápido)
                const [qData, uData] = await Promise.all([
                    getProcapQuestions(),
                    getUserExamAnswers(currentUser.id)
                ]);
                
                if (isMounted) {
                    setQuestions(qData);
                    setUserAnswers(uData);
                    setIsLoading(false); // Libera a UI imediatamente
                }

                // 2. Carregamento Secundário: Estatísticas da Comunidade (Lento)
                // Executa apenas após a UI estar pronta
                const allData = await getAllUserExamAnswers();
                if (isMounted) {
                    setAllAnswers(allData);
                }
            } catch (error) {
                console.error("Error loading exam data:", error);
                if (isMounted) setIsLoading(false);
            }
        };

        loadData();

        return () => { isMounted = false; };
    }, [currentUser.id]);

    const handleSelectAnswer = async (qNum: number, answer: string) => {
        // Optimistic update
        const existingAnswer = userAnswers.find(a => a.question_number === qNum);
        
        // Se clicar na mesma resposta, desmarca
        if (existingAnswer?.selected_answer === answer) {
            const newAnswers = userAnswers.filter(a => a.question_number !== qNum);
            setUserAnswers(newAnswers);
            await deleteUserExamAnswer(currentUser.id, qNum);
        } else {
            // Se clicar em outra, atualiza
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
            setTimeout(() => {
                const nextQuestionElement = document.getElementById(`q-card-${qNum + 1}`);
                if (nextQuestionElement) {
                    nextQuestionElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 300);

            const result = await saveUserExamAnswer(currentUser.id, qNum, answer);
            if (!result) {
                // Revert optimistic update on failure
                alert("Erro ao salvar resposta. Verifique sua conexão.");
                setUserAnswers(prev => prev.filter(a => a.id !== newAnswer.id));
                if (existingAnswer) setUserAnswers(prev => [...prev, existingAnswer]);
            }
        }
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
            official: { correct: officialCorrect, total: totalOfficial > 0 ? questions.filter(q=>q.gabarito_preliminar && userAnswers.some(a=>a.question_number===q.question_number)).length : 0 }, 
            majority: { agreement: majorityAgreement, total: answeredCount }
        };
    }, [userAnswers, questions, allAnswers]);

    // Histogram Data Logic
    const histogramData = useMemo(() => {
        if (allAnswers.length === 0 || questions.length === 0) return { data: [], currentUserScore: 0 };

        // 1. Build the "Correct Key" based on comparison mode
        const correctKey: Record<number, string> = {};
        questions.forEach(q => {
            let answer = '';
            if (comparisonMode === 'official') answer = q.gabarito_preliminar || '';
            else if (comparisonMode === 'ai') answer = q.ai_correct_answer || '';
            else if (comparisonMode === 'majority') answer = calculateMajority(q.question_number)?.answer || '';
            
            if (answer) correctKey[q.question_number] = answer.toLowerCase();
        });

        // 2. Calculate score for each user
        const userScores: Record<string, number> = {};
        allAnswers.forEach(ans => {
            if (!userScores[ans.user_id]) userScores[ans.user_id] = 0;
            
            const correctAnswer = correctKey[ans.question_number];
            if (correctAnswer && ans.selected_answer === correctAnswer) {
                userScores[ans.user_id]++;
            }
        });

        // Ensure current user is in the map (even if score is 0)
        const myScore = userScores[currentUser.id] || 0;

        // 3. Aggregate scores into distribution
        const scoreCounts: Record<number, number> = {};
        // Initialize likely range (0-40)
        for(let i=0; i<=40; i++) scoreCounts[i] = 0;

        Object.values(userScores).forEach(score => {
            scoreCounts[score] = (scoreCounts[score] || 0) + 1;
        });

        const data = Object.entries(scoreCounts).map(([score, count]) => ({
            score: Number(score),
            count
        })).filter(d => d.score > 0 && d.count > 0).sort((a,b) => a.score - b.score);

        return { data, currentUserScore: myScore };

    }, [allAnswers, questions, comparisonMode, currentUser.id]);


    const divergences = useMemo(() => {
        return questions.filter(q => {
            const ai = q.ai_correct_answer?.toLowerCase();
            const official = q.gabarito_preliminar?.toLowerCase();
            const majority = calculateMajority(q.question_number)?.answer;
            
            const aiVsOfficial = official && ai !== official;
            const officialVsMajority = official && majority && official !== majority;
            const aiVsMajority = majority && ai !== majority;
            
            return aiVsOfficial || officialVsMajority || aiVsMajority;
        });
    }, [questions, allAnswers]);

    const renderQuestionText = (text: string) => {
        // Replace literal "\n" or actual newlines with rendered breaks
        return text.split(/\\n|\n/).map((line, index) => (
            <p key={index} className={`mb-2 ${FONT_SIZE_CLASSES_LARGE[fontSize]}`}>{line}</p>
        ));
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500 gap-2">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-light"></div>
                <p>Carregando Prova...</p>
            </div>
        );
    }

    const modeLabels = {
        official: 'Gabarito Preliminar',
        ai: 'Inteligência Artificial',
        majority: 'Maioria da Comunidade'
    };

    return (
        <div className="space-y-6 pb-20 animate-fade-in-up">
            
            {/* Header controls */}
            <div className="flex justify-end">
                <FontSizeControl fontSize={fontSize} setFontSize={setFontSize} maxSize={4} />
            </div>

            {/* Distribution Histogram */}
            <div className="bg-card-light dark:bg-card-dark p-6 rounded-lg border border-border-light dark:border-border-dark shadow-sm">
                <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                    <h3 className="text-lg font-bold">Distribuição de Notas (Acertos / 40)</h3>
                    <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                        {(['official', 'ai', 'majority'] as const).map((mode) => (
                            <button
                                key={mode}
                                onClick={() => setComparisonMode(mode)}
                                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                                    comparisonMode === mode
                                        ? 'bg-white dark:bg-gray-700 text-primary-light dark:text-primary-dark shadow-sm'
                                        : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                                }`}
                            >
                                {modeLabels[mode]}
                            </button>
                        ))}
                    </div>
                </div>
                
                <div className="h-64 w-full">
                    {histogramData.data.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={histogramData.data} margin={{top: 20, right: 30, left: 0, bottom: 5}}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="score" />
                                <YAxis allowDecimals={false} />
                                <Tooltip 
                                    cursor={{fill: 'rgba(200,200,200,0.1)'}}
                                    contentStyle={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)', borderRadius: '8px' }}
                                />
                                <Bar dataKey="count" name="Usuários" radius={[4, 4, 0, 0]}>
                                    {histogramData.data.map((entry, index) => (
                                        <Cell 
                                            key={`cell-${index}`} 
                                            fill={entry.score === histogramData.currentUserScore ? '#10b981' : '#6366f1'} 
                                        />
                                    ))}
                                </Bar>
                                <ReferenceLine x={histogramData.currentUserScore} stroke="#10b981" label={{ value: 'Você', position: 'top', fill:'#10b981', fontSize: 12, fontWeight: 'bold' }} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="h-full flex items-center justify-center text-gray-400">
                            Dados insuficientes para o gráfico
                        </div>
                    )}
                </div>
                <p className="text-center text-xs text-gray-500 mt-2">
                    Baseado em {comparisonMode === 'official' ? 'Gabarito Preliminar' : comparisonMode === 'ai' ? 'Correção da IA' : 'Maioria dos Votos'}
                </p>
            </div>

            {/* Stats Dashboard */}
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

            {/* Divergences Alert */}
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

            {/* Questions Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: 40 }, (_, i) => i + 1).map(num => {
                    const questionData = questions.find(q => q.question_number === num);
                    const userAnswer = userAnswers.find(u => u.question_number === num)?.selected_answer;
                    const majority = calculateMajority(num);
                    
                    let optionsMap: any = null;
                    if (questionData?.options) {
                         try {
                             optionsMap = typeof questionData.options === 'string' ? JSON.parse(questionData.options) : questionData.options;
                         } catch (e) {
                             // Fallback if JSON parse fails, potentially handle raw string
                             optionsMap = null;
                         }
                    }

                    return (
                        <div id={`q-card-${num}`} key={num} className={`relative bg-card-light dark:bg-card-dark rounded-lg border shadow-sm flex flex-col transition-all duration-200 ${userAnswer ? 'border-primary-light dark:border-primary-dark ring-1 ring-primary-light dark:ring-primary-dark' : 'border-border-light dark:border-border-dark'}`}>
                            <div className="p-3 border-b border-border-light dark:border-border-dark flex justify-between items-center bg-gray-50 dark:bg-gray-800/50 rounded-t-lg">
                                <span className="font-bold text-lg">Questão {num}</span>
                                <div className="flex gap-1 text-xs flex-wrap justify-end">
                                    {questionData?.ai_correct_answer && (
                                        <div className="relative group">
                                            <span 
                                                title={questionData.ai_justificativa ? "Ver justificativa da IA" : "Gabarito IA"} 
                                                className={`px-1.5 py-0.5 rounded font-mono cursor-help flex items-center gap-1
                                                    ${questionData.ai_justificativa ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-400' : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'}
                                                `}
                                            >
                                                AI:{questionData.ai_correct_answer.toUpperCase()}
                                                {questionData.ai_justificativa && <span className="text-[10px] opacity-80">ℹ️</span>}
                                            </span>
                                            {questionData.ai_justificativa && (
                                                <div className="absolute bottom-full right-0 mb-2 w-64 p-3 bg-gray-800 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 leading-relaxed border border-gray-600">
                                                    <div className="font-bold mb-1 text-blue-300">Justificativa IA:</div>
                                                    {questionData.ai_justificativa}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {questionData?.gabarito_preliminar && <span title="Gabarito Preliminar" className="px-1.5 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 font-mono">OF:{questionData.gabarito_preliminar.toUpperCase()}</span>}
                                    {majority && majority.count > 1 && (
                                        <div className="relative group">
                                            <span title="Maioria" className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 font-mono cursor-help">
                                                {majority.percentage.toFixed(0)}%{majority.answer.toUpperCase()}
                                            </span>
                                            <div className="absolute bottom-full right-0 mb-2 w-max p-2 bg-gray-800 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 border border-gray-600">
                                                {majority.count} votos de {majority.total}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            <div className="p-4 flex-grow flex flex-col justify-between gap-4">
                                {questionData?.question_text ? (
                                    <div onClick={() => setExpandedQuestion(expandedQuestion === num ? null : num)} className="cursor-pointer group">
                                        <div className={`text-sm text-foreground-light dark:text-foreground-dark transition-all ${expandedQuestion === num ? '' : 'line-clamp-4 group-hover:text-primary-light dark:group-hover:text-primary-dark'}`}>
                                            {renderQuestionText(questionData.question_text)}
                                        </div>
                                        {optionsMap && expandedQuestion === num && (
                                            <div className={`mt-3 text-xs space-y-2 text-gray-600 dark:text-gray-300 border-t pt-2 border-gray-200 dark:border-gray-700 animate-fade-in-up ${FONT_SIZE_CLASSES_LARGE[fontSize]}`}>
                                                {Object.entries(optionsMap).map(([key, val]: [string, any]) => (
                                                    <div key={key} className={`p-1 rounded ${userAnswer === key ? 'bg-primary-light/10 text-primary-light font-bold' : ''}`}>
                                                        <span className="uppercase font-bold mr-1">{key})</span> {val}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {expandedQuestion !== num && <p className="text-xs text-center text-gray-400 mt-1">clique para expandir</p>}
                                    </div>
                                ) : (
                                    <div className="text-sm text-gray-400 italic text-center py-8 bg-gray-50 dark:bg-gray-800/30 rounded">
                                        Texto indisponível
                                    </div>
                                )}

                                <div className="flex justify-between items-center mt-auto pt-2">
                                    {['a', 'b', 'c', 'd', 'e'].map(opt => {
                                        const isSelected = userAnswer === opt;
                                        const isAi = questionData?.ai_correct_answer?.toLowerCase() === opt;
                                        const isOfficial = questionData?.gabarito_preliminar?.toLowerCase() === opt;
                                        
                                        let ringColor = '';
                                        if (isOfficial) ringColor = 'ring-2 ring-green-500';
                                        else if (isAi && !questionData?.gabarito_preliminar) ringColor = 'ring-2 ring-blue-400';

                                        return (
                                            <button
                                                key={opt}
                                                onClick={() => handleSelectAnswer(num, opt)}
                                                className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-all shadow-sm ${ringColor}
                                                    ${isSelected 
                                                        ? 'bg-primary-light dark:bg-primary-dark text-white scale-110' 
                                                        : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300'
                                                    }
                                                `}
                                            >
                                                {opt.toUpperCase()}
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
