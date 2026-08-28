import { Component } from 'react'
export default class ErrorBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed)
      return (
        <main className="checkin-card error-fallback">
          <h1>화면을 표시하지 못했습니다</h1>
          <p className="lead">
            저장된 기록을 초기화하지 않았습니다. 새로고침 후에도 문제가 계속되면 담당자에게 문의해
            주세요.
          </p>
          <button className="button primary" onClick={() => window.location.reload()}>
            다시 열기
          </button>
        </main>
      )
    return this.props.children
  }
}
