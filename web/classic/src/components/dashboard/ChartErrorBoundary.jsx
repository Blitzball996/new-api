/*
Blitzball: VChart error boundary to prevent dashboard crash when the
chart library fails to initialize its canvas (createCanvas undefined).
*/
import React from 'react';

class ChartErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ChartErrorBoundary] chart render failed:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className='flex h-full w-full items-center justify-center text-sm text-gray-400'>
          {this.props.fallbackText || '图表暂时无法显示'}
        </div>
      );
    }
    return this.props.children;
  }
}

export default ChartErrorBoundary;
