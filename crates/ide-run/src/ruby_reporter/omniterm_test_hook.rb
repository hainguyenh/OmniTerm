# Written by OmniTerm for test runs. Loaded first in every Ruby the run starts
# (RUBYLIB=<this directory>, RUBYOPT=-romniterm_test_hook).
#
# Registers the test reporter once a test framework is loaded. Minitest 5 would find a plugin on
# its own, Minitest 6 does not load plugins any more, so both are registered the same way.
if ENV["OMNITERM_TEST_REPORT"]
  module OmniTermTestHook
    @registered = false

    def self.register
      return if @registered
      return unless defined?(::Minitest) && ::Minitest.respond_to?(:extensions) && defined?(::Minitest::AbstractReporter)

      @registered = true
      require "omniterm/minitest_reporter"
      ::Minitest.extensions << "omniterm" unless ::Minitest.extensions.include?("omniterm")
    rescue StandardError, LoadError
      nil # reporting must never break a test run
    end

    # `require "minitest/autorun"` loads Minitest through require_relative, so look after every require.
    module Watch
      def require(path)
        result = super
        OmniTermTestHook.register
        result
      end
    end
  end

  Kernel.prepend(OmniTermTestHook::Watch)
end
