import { isAutoRunPausedError } from './auto-run-control.js';

async function continueFromLoginAfterStep3({ addLog, checkAutoControl, executeSignupStep, pollVerificationCode, fillLastCode } = {}) {
  await addLog('步骤 3：检测到当前邮箱已注册，切换到登录流程并跳过注册验证码与资料填写');
  await checkAutoControl();
  const loginStep6Result = await executeSignupStep(6);
  if (loginStep6Result?.needsProfileCompletion) {
    await addLog('步骤 6：检测到资料页，返回步骤 5 补全资料');
    return { needsProfileCompletion: true };
  }
  if (loginStep6Result?.needsOTP !== false) {
    await checkAutoControl();
    await pollVerificationCode('login');
    await checkAutoControl();
    await fillLastCode('login');
  } else {
    await addLog('步骤 6：已通过密码登录，跳过登录验证码阶段');
  }
  return { needsProfileCompletion: false };
}

export async function runSingleAutoFlow({ actions = {} } = {}) {
  const {
    addLog = async () => {},
    checkAutoControl = async () => {},
    prepareNextAccount,
    refreshOauthFromVps = async () => {},
    findCurrentEmailRecord,
    openOauthUrl,
    executeSignupStep,
    executeFinalVerifyStep = async () => {},
    pollVerificationCode,
    fillLastCode,
    completeCurrentAccount,
  } = actions;

  await checkAutoControl();
  await prepareNextAccount();
  await addLog('单轮自动流程开始');

  await checkAutoControl();
  await addLog('阶段 1：刷新 CPA 并重新获取 OAuth 链接');
  await refreshOauthFromVps();

  await checkAutoControl();
  await findCurrentEmailRecord();
  await addLog('阶段 2：打开认证页面并进入注册流程');
  // 步骤1 已经会自动打开 OAuth 页面，这里作为兜底（比如断点续跑时步骤1没执行）
  await openOauthUrl();
  await checkAutoControl();
  await executeSignupStep(2);
  await checkAutoControl();
  const signupStep3Result = await executeSignupStep(3);
  const skipSignupVerification = Boolean(signupStep3Result?.skipSignupVerification);
  const switchToLoginFlow = Boolean(signupStep3Result?.switchToLoginFlow);
  if (switchToLoginFlow) {
    const loginResult = await continueFromLoginAfterStep3({
      addLog,
      checkAutoControl,
      executeSignupStep,
      pollVerificationCode,
      fillLastCode,
    });
    if (loginResult?.needsProfileCompletion) {
      const recoveredProfileResult = await executeSignupStep(5);
      if (recoveredProfileResult?.needsOTP === false) {
        await addLog('步骤 6：资料页已补全，直接进入授权阶段');
      } else {
        await checkAutoControl();
        await pollVerificationCode('login');
        await checkAutoControl();
        await fillLastCode('login');
      }
    }
  } else {
    if (skipSignupVerification) {
      await addLog('步骤 3：检测到当前邮箱已进入资料页，跳过注册码阶段');
    } else {
      await checkAutoControl();
      await pollVerificationCode('signup');
      await checkAutoControl();
      await fillLastCode('signup');
    }
    await checkAutoControl();
    await executeSignupStep(5);
    await checkAutoControl();
    const loginStep6Result = await executeSignupStep(6);
    if (loginStep6Result?.needsProfileCompletion) {
      await addLog('步骤 6：检测到资料页，返回步骤 5 补全资料');
      const recoveredProfileResult = await executeSignupStep(5);
      if (recoveredProfileResult?.needsOTP === false) {
        await addLog('步骤 6：资料页已补全，直接进入授权阶段');
      } else {
        await checkAutoControl();
        await pollVerificationCode('login');
        await checkAutoControl();
        await fillLastCode('login');
      }
    } else if (loginStep6Result?.needsOTP !== false) {
      await checkAutoControl();
      await pollVerificationCode('login');
      await checkAutoControl();
      await fillLastCode('login');
    } else {
      await addLog('步骤 6：已通过密码登录，跳过登录验证码阶段');
    }
  }
  await checkAutoControl();
  await executeSignupStep(8);
  await checkAutoControl();
  await executeFinalVerifyStep();
  await checkAutoControl();
  const result = await completeCurrentAccount();
  await addLog('单轮自动流程完成，当前邮箱已标记为已使用');

  return result;
}

function getFirstIncompleteStep(stepStatuses = {}) {
  let highestCompletedStep = 0;

  for (let step = 1; step <= 9; step += 1) {
    if (stepStatuses[step] === 'completed' && step > highestCompletedStep) {
      highestCompletedStep = step;
    }
  }

  const nextStep = highestCompletedStep + 1;
  if (nextStep > 9) {
    return null;
  }
  return nextStep;
}

export async function continueSingleAutoFlow({ state = {}, actions = {} } = {}) {
  const {
    addLog = async () => {},
    checkAutoControl = async () => {},
    refreshOauthFromVps = async () => {},
    findCurrentEmailRecord,
    openOauthUrl,
    executeSignupStep,
    executeFinalVerifyStep = async () => {},
    pollVerificationCode,
    fillLastCode,
    completeCurrentAccount,
  } = actions;

  const startStep = getFirstIncompleteStep(state.stepStatuses || {});
  if (!startStep) {
    await addLog('当前流程已全部完成，无需继续');
    return { status: 'completed', continuedFrom: null };
  }

  await checkAutoControl();
  await addLog(`继续自动流程：从步骤 ${startStep} 开始`);

  if (startStep <= 1) {
    await addLog('阶段 1：刷新 CPA 并重新获取 OAuth 链接');
    await refreshOauthFromVps();
    await checkAutoControl();
    await findCurrentEmailRecord();
    await addLog('阶段 2：打开认证页面并进入注册流程');
    await openOauthUrl();
  }

  if (startStep === 2) {
    await checkAutoControl();
    await executeSignupStep(2);
  }

  if (startStep <= 3) {
    await checkAutoControl();
    const signupStep3Result = await executeSignupStep(3);
    if (signupStep3Result?.switchToLoginFlow) {
      const loginResult = await continueFromLoginAfterStep3({
        addLog,
        checkAutoControl,
        executeSignupStep,
        pollVerificationCode,
        fillLastCode,
      });
      if (loginResult?.needsProfileCompletion) {
        const recoveredProfileResult = await executeSignupStep(5);
        if (recoveredProfileResult?.needsOTP === false) {
          await addLog('步骤 6：资料页已补全，直接进入授权阶段');
        } else {
          await checkAutoControl();
          await pollVerificationCode('login');
          await checkAutoControl();
          await fillLastCode('login');
        }
      }
      await checkAutoControl();
      await executeSignupStep(8);
      await checkAutoControl();
      await executeFinalVerifyStep();
      await checkAutoControl();
      const result = await completeCurrentAccount();
      await addLog('自动流程继续完成，当前邮箱已标记为已使用');
      return result;
    } else if (signupStep3Result?.skipSignupVerification) {
      await addLog('步骤 3：检测到当前邮箱已进入资料页，跳过注册码阶段');
    } else {
      await checkAutoControl();
      await pollVerificationCode('signup');
      await checkAutoControl();
      await fillLastCode('signup');
    }
  } else if (startStep === 4) {
    await checkAutoControl();
    await pollVerificationCode('signup');
    await checkAutoControl();
    await fillLastCode('signup');
  }

  if (startStep <= 5) {
    await checkAutoControl();
    await executeSignupStep(5);
  }

  if (startStep <= 6) {
    await checkAutoControl();
    const loginStep6Result = await executeSignupStep(6);
    if (loginStep6Result?.needsProfileCompletion) {
      await addLog('步骤 6：检测到资料页，返回步骤 5 补全资料');
      const recoveredProfileResult = await executeSignupStep(5);
      if (recoveredProfileResult?.needsOTP === false) {
        await addLog('步骤 6：资料页已补全，直接进入授权阶段');
      } else {
        await checkAutoControl();
        await pollVerificationCode('login');
        await checkAutoControl();
        await fillLastCode('login');
      }
    } else if (loginStep6Result?.needsOTP !== false) {
      await checkAutoControl();
      await pollVerificationCode('login');
      await checkAutoControl();
      await fillLastCode('login');
    } else {
      await addLog('步骤 6：已通过密码登录，跳过登录验证码阶段');
    }
  } else if (startStep === 7) {
    await checkAutoControl();
    await pollVerificationCode('login');
    await checkAutoControl();
    await fillLastCode('login');
  }

  if (startStep <= 8) {
    await checkAutoControl();
    await executeSignupStep(8);
  }

  if (startStep <= 9) {
    await checkAutoControl();
    await executeFinalVerifyStep();
  }

  await checkAutoControl();
  const result = await completeCurrentAccount();
  await addLog('自动流程继续完成，当前邮箱已标记为已使用');
  return result;
}

export async function runAutoFlowBatch({
  runCount = 1,
  startIndex = 0,
  continueOnError = false,
  runFlow,
  onAttemptError = async () => {},
  onPaused = async () => {},
} = {}) {
  if (typeof runFlow !== 'function') {
    throw new Error('runAutoFlowBatch 需要 runFlow 函数');
  }

  const results = [];
  const failures = [];
  const totalRuns = Math.max(1, Number(runCount) || 1);
  const safeStartIndex = Math.max(0, Math.min(totalRuns, Number(startIndex) || 0));

  for (let attempt = safeStartIndex; attempt < totalRuns; attempt += 1) {
    try {
      results.push(await runFlow(attempt));
    } catch (error) {
      if (isAutoRunPausedError(error)) {
        await onPaused(attempt, error);
        return { results, failures, pausedAt: attempt };
      }
      failures.push({ attempt, error });
      await onAttemptError(error, attempt);
      if (!continueOnError) {
        throw error;
      }
    }
  }

  return { results, failures, pausedAt: null };
}
